import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ListQueuesCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { SqsTransactionWorker } from "../../src/wagering/messaging/sqs-transaction-worker";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { metricValue } from "../support/metrics";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const ENDPOINT = process.env.SQS_ENDPOINT || "http://localhost:4566";
const ENV_KEYS = [
  "SQS_ENDPOINT",
  "SQS_TRANSACTIONS_QUEUE_URL",
  "SQS_TRANSACTIONS_DLQ_URL",
  "SQS_RETRY_BASE_SECONDS",
  "SQS_CONSUMER_ENABLED",
] as const;

describe.skipIf(process.env.SKIP_SQS_TESTS === "1")("SQS real (LocalStack)", () => {
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const sqs = new SQSClient({ region: REGION, endpoint: ENDPOINT });
  let ctx: TestContext;
  let worker: SqsTransactionWorker;
  let queueUrl: string;
  let dlqUrl: string;
  let baseUrl: string;
  let wallet: WalletOutput;
  let sequence = 0;

  beforeAll(async () => {
    try {
      await sqs.send(new ListQueuesCommand({}), { abortSignal: AbortSignal.timeout(5000) });
    } catch (error) {
      throw new Error(
        `SQS indisponivel em ${ENDPOINT} (${String(error)}). ` +
          'Suba com "docker compose up -d localstack" ou rode com SKIP_SQS_TESTS=1 para pular.',
      );
    }

    const suffix = uuidv7().slice(-12);
    dlqUrl = await createQueue(`wager-test-dlq-${suffix}.fifo`, { FifoQueue: "true" });
    const dlqArn = await queueArn(dlqUrl);
    queueUrl = await createQueue(`wager-test-${suffix}.fifo`, {
      FifoQueue: "true",
      ContentBasedDeduplication: "false",
      VisibilityTimeout: "30",
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 2 }),
    });

    process.env.SQS_ENDPOINT = ENDPOINT;
    process.env.SQS_TRANSACTIONS_QUEUE_URL = queueUrl;
    process.env.SQS_TRANSACTIONS_DLQ_URL = dlqUrl;
    process.env.SQS_RETRY_BASE_SECONDS = "1";
    delete process.env.SQS_CONSUMER_ENABLED;

    ctx = await createTestContext();
    baseUrl = await ctx.startHttp();
    worker = new SqsTransactionWorker(ctx.consumer, ctx.metrics);
    worker.onApplicationBootstrap();
  });

  afterAll(async () => {
    await worker?.onApplicationShutdown();
    await ctx?.close();
    for (const url of [queueUrl, dlqUrl]) {
      if (url) {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: url })).catch(() => undefined);
      }
    }
    sqs.destroy();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  beforeEach(async () => {
    await ctx.reset();
    wallet = await ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
  });

  async function createQueue(name: string, attributes: Record<string, string>): Promise<string> {
    const response = await sqs.send(
      new CreateQueueCommand({ QueueName: name, Attributes: attributes }),
    );
    return response.QueueUrl as string;
  }

  async function queueArn(url: string): Promise<string> {
    const response = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
    );
    return response.Attributes?.QueueArn as string;
  }

  function requested(messageId = uuidv7()): { body: string; messageId: string } {
    sequence += 1;
    const body = JSON.stringify({
      messageId,
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-a",
        externalTransactionId: `sqs-tx-${sequence}`,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
      },
    });
    return { body, messageId };
  }

  async function send(body: string, deduplicationId = uuidv7()): Promise<void> {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageGroupId: wallet.id,
        MessageDeduplicationId: deduplicationId,
      }),
    );
  }

  async function waitFor<T>(
    check: () => Promise<T | undefined | false>,
    timeoutMs = 25_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`condicao nao atendida em ${timeoutMs}ms`);
  }

  async function balance(): Promise<string> {
    return (await ctx.getWallet.execute(wallet.id)).balance.amount;
  }

  async function queueIsEmpty(): Promise<boolean> {
    const response = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
      }),
    );
    const attributes = response.Attributes ?? {};
    return (
      attributes.ApproximateNumberOfMessages === "0" &&
      attributes.ApproximateNumberOfMessagesNotVisible === "0"
    );
  }

  async function takeFromDlq(matches: (message: Message) => boolean): Promise<Message> {
    return waitFor(async () => {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 2,
          MessageAttributeNames: ["All"],
        }),
      );
      const found = (response.Messages ?? []).find(matches);
      if (found) {
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: dlqUrl, ReceiptHandle: found.ReceiptHandle }),
        );
      }
      return found;
    });
  }

  function metric(series: string): number {
    return metricValue(ctx.metrics.render({ pending: 0, oldestPendingAgeSeconds: 0 }), series);
  }

  it("processa a mensagem da fila: debita uma vez, grava o inbox e remove da fila", async () => {
    await send(requested().body);

    await waitFor(async () => (await balance()) === "75.00");
    await waitFor(queueIsEmpty);

    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    expect(await ctx.inboxCount()).toBe(1);
    expect(metric('wager_transactions_total{status="PROCESSED"}')).toBe(1);
    await expectInvariant(ctx, wallet.id);
  }, 30_000);

  it("a mesma mensagem entregue duas vezes (dedup do SQS contornado) debita uma vez", async () => {
    const { body } = requested();

    await send(body, uuidv7());
    await send(body, uuidv7());

    await waitFor(async () => (await balance()) === "75.00");
    await waitFor(queueIsEmpty);

    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    expect(await ctx.inboxCount()).toBe(1);
    expect(metric("wager_duplicates_total")).toBe(1);
  }, 30_000);

  it("mensagem invalida vai para a DLQ com o motivo e nada e gravado", async () => {
    const invalid = "isso nao e json";
    await send(invalid);

    const inDlq = await takeFromDlq((message) => message.Body === invalid);

    expect(inDlq.MessageAttributes?.reason?.StringValue).toBeTruthy();
    expect(metric("wager_dlq_messages_total")).toBe(1);
    await waitFor(queueIsEmpty);
    expect(await ctx.inboxCount()).toBe(0);
    expect(await balance()).toBe("100.00");
  }, 30_000);

  it("falha transitoria: a mensagem volta para a fila e e processada na nova tentativa", async () => {
    const consume = spyOn(ctx.consumer, "consume").mockRejectedValueOnce(new Error("db down"));
    try {
      await send(requested().body);

      await waitFor(async () => (await balance()) === "75.00");
      await waitFor(queueIsEmpty);

      expect(consume.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
      expect(await ctx.inboxCount()).toBe(1);
      expect(metric('wager_retries_total{source="sqs"}')).toBeGreaterThanOrEqual(1);
    } finally {
      consume.mockRestore();
    }
  }, 30_000);

  it("falha transitoria que nao passa: apos o limite de recebimentos o SQS manda para a DLQ", async () => {
    const consume = spyOn(ctx.consumer, "consume").mockRejectedValue(new Error("db down"));
    try {
      const { body } = requested();
      await send(body);

      const inDlq = await takeFromDlq((message) => message.Body === body);

      expect(inDlq.Body).toBe(body);
      expect(consume.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(await ctx.inboxCount()).toBe(0);
      expect(await balance()).toBe("100.00");
    } finally {
      consume.mockRestore();
    }
  }, 40_000);

  it("health/ready responde 200 com Postgres e SQS reais", async () => {
    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: { postgres: "up", sqs: "up" },
    });
  });
});
