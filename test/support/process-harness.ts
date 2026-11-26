import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { TEST_DATABASE } from "./test-database";

const ROOT = path.resolve(__dirname, "../..");
const REGION = process.env.AWS_REGION ?? "us-east-1";

export const SQS_ENDPOINT = process.env.SQS_ENDPOINT || "http://localhost:4566";

export interface Queues {
  transactionsUrl: string;
  dlqUrl: string;
  eventsUrl: string;
  client: SQSClient;
  destroy(): Promise<void>;
}

export interface AppProcess {
  readonly port: number;
  readonly url: string;
  readonly pid: number;
  readonly exited: Promise<number>;
  isAlive(): boolean;
  kill(signal?: NodeJS.Signals): void;
  stop(): Promise<number>;
  logs(): string;
}

export interface StartOptions {
  port: number;
  queues?: Queues;
  workers?: boolean;
  env?: Record<string, string>;
}

export async function createQueues(visibilityTimeout = 5, maxReceiveCount = 5): Promise<Queues> {
  const client = new SQSClient({ region: REGION, endpoint: SQS_ENDPOINT });
  const suffix = uuidv7().slice(-12);

  const dlq = await client.send(
    new CreateQueueCommand({
      QueueName: `proc-dlq-${suffix}.fifo`,
      Attributes: { FifoQueue: "true" },
    }),
  );
  const dlqArn = (
    await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlq.QueueUrl,
        AttributeNames: ["QueueArn"],
      }),
    )
  ).Attributes?.QueueArn as string;

  const transactions = await client.send(
    new CreateQueueCommand({
      QueueName: `proc-tx-${suffix}.fifo`,
      Attributes: {
        FifoQueue: "true",
        ContentBasedDeduplication: "false",
        VisibilityTimeout: String(visibilityTimeout),
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: dlqArn,
          maxReceiveCount: String(maxReceiveCount),
        }),
      },
    }),
  );
  const events = await client.send(new CreateQueueCommand({ QueueName: `proc-events-${suffix}` }));

  const urls = [transactions.QueueUrl, dlq.QueueUrl, events.QueueUrl] as string[];
  return {
    transactionsUrl: urls[0] as string,
    dlqUrl: urls[1] as string,
    eventsUrl: urls[2] as string,
    client,
    async destroy() {
      for (const url of urls) {
        await client.send(new DeleteQueueCommand({ QueueUrl: url })).catch(() => undefined);
      }
      client.destroy();
    },
  };
}

export async function queueDepth(client: SQSClient, queueUrl: string): Promise<number> {
  const response = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: queueUrl,
      AttributeNames: [
        "ApproximateNumberOfMessages",
        "ApproximateNumberOfMessagesNotVisible",
        "ApproximateNumberOfMessagesDelayed",
      ],
    }),
  );
  const attributes = response.Attributes ?? {};
  return Object.values(attributes).reduce((total, value) => total + Number(value), 0);
}

export async function drainEventIds(client: SQSClient, queueUrl: string): Promise<string[]> {
  const eventIds: string[] = [];
  let emptyReads = 0;
  while (emptyReads < 3) {
    const response = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    const messages = response.Messages ?? [];
    if (messages.length === 0) {
      emptyReads += 1;
      continue;
    }
    emptyReads = 0;
    for (const message of messages) {
      eventIds.push((JSON.parse(message.Body ?? "{}") as { id: string }).id);
    }
    await client.send(
      new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: messages.map((message, index) => ({
          Id: String(index),
          ReceiptHandle: message.ReceiptHandle as string,
        })),
      }),
    );
  }
  return eventIds;
}

export async function waitFor(
  description: string,
  condition: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timeout (${timeoutMs}ms) esperando: ${description}`);
}

export async function startApp(options: StartOptions): Promise<AppProcess> {
  const { port, queues, workers = true } = options;
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(port),
    DB_NAME: TEST_DATABASE,
    SQS_ENDPOINT,
    SQS_TRANSACTIONS_QUEUE_URL: `${SQS_ENDPOINT}/000000000000/unused.fifo`,
    SQS_TRANSACTIONS_DLQ_URL: `${SQS_ENDPOINT}/000000000000/unused-dlq.fifo`,
    SQS_EVENTS_QUEUE_URL: `${SQS_ENDPOINT}/000000000000/unused-events`,
    OUTBOX_POLL_INTERVAL_MS: "200",
    PENDING_REFERENCE_POLL_INTERVAL_MS: "500",
    SQS_RETRY_BASE_SECONDS: "1",
    OUTBOX_WORKER_ENABLED: String(workers),
    SQS_CONSUMER_ENABLED: String(workers),
    PENDING_REFERENCE_WORKER_ENABLED: String(workers),
    ...options.env,
  };
  if (queues) {
    env["SQS_TRANSACTIONS_QUEUE_URL"] = queues.transactionsUrl;
    env["SQS_TRANSACTIONS_DLQ_URL"] = queues.dlqUrl;
    env["SQS_EVENTS_QUEUE_URL"] = queues.eventsUrl;
  }

  const child = Bun.spawn([process.execPath, "run", "src/main.ts"], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const lines: string[] = [];
  const collect = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      lines.push(decoder.decode(chunk, { stream: true }));
      if (lines.length > 500) {
        lines.splice(0, 250);
      }
    }
  };
  void collect(child.stdout);
  void collect(child.stderr);

  let alive = true;
  const exited = child.exited.then((code) => {
    alive = false;
    return code;
  });

  const app: AppProcess = {
    port,
    url: `http://127.0.0.1:${port}`,
    pid: child.pid,
    exited,
    isAlive: () => alive,
    kill: (signal = "SIGKILL") => {
      if (alive) {
        child.kill(signal);
      }
    },
    async stop() {
      if (!alive) {
        return exited;
      }
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
      const code = await exited;
      clearTimeout(timeout);
      return code;
    },
    logs: () => lines.join(""),
  };

  try {
    await waitFor(
      `app na porta ${port}`,
      async () => {
        if (!alive) {
          throw new Error(`processo saiu antes de ficar pronto:\n${app.logs().slice(-2000)}`);
        }
        try {
          const response = await fetch(`${app.url}/health/live`, {
            signal: AbortSignal.timeout(1000),
          });
          return response.ok;
        } catch {
          return false;
        }
      },
      30_000,
      200,
    );
  } catch (error) {
    app.kill("SIGKILL");
    throw error;
  }
  return app;
}

export async function stopAll(apps: AppProcess[]): Promise<void> {
  await Promise.all(apps.map((app) => app.stop().catch(() => undefined)));
}

export interface WagerBody {
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
}

export interface WagerHttpResult {
  status: number;
  body: {
    transactionId?: string;
    status?: string;
    idempotentReplay?: boolean;
    failureCode?: string;
    code?: string;
  };
}

export async function postWager(
  app: AppProcess,
  body: WagerBody,
  idempotencyKey = `${body.providerId}:${body.externalTransactionId}`,
): Promise<WagerHttpResult> {
  const response = await fetch(`${app.url}/wagering/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as WagerHttpResult["body"],
  };
}

export function wagerBody(
  wallet: { id: string; playerId: string },
  externalTransactionId: string,
  amount: string,
  kind = "BET",
): WagerBody {
  return {
    providerId: "provider-a",
    externalTransactionId,
    walletId: wallet.id,
    playerId: wallet.playerId,
    roundId: "round-1",
    gameId: "game-1",
    kind,
    money: { amount, currency: "BRL" },
  };
}

export function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port as number;
  void server.stop(true);
  return port;
}

export async function startMany(
  count: number,
  options: Omit<StartOptions, "port">,
): Promise<AppProcess[]> {
  return Promise.all(
    Array.from({ length: count }, () => startApp({ ...options, port: freePort() })),
  );
}
