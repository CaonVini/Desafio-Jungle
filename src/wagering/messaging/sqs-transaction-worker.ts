import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { MetricsService } from "../../metrics/metrics.service";
import { PermanentMessageError, WagerTransactionConsumer } from "./wager-transaction-consumer";

const MAX_RETRY_SECONDS = 300;

@Injectable()
export class SqsTransactionWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SqsTransactionWorker.name);
  private client: SQSClient | undefined;
  private queueUrl = "";
  private dlqUrl = "";
  private baseRetrySeconds = 5;
  private running: Promise<void> = Promise.resolve();
  private readonly abort = new AbortController();

  constructor(
    private readonly consumer: WagerTransactionConsumer,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.SQS_CONSUMER_ENABLED === "false") {
      return;
    }
    const queueUrl = process.env.SQS_TRANSACTIONS_QUEUE_URL;
    const dlqUrl = process.env.SQS_TRANSACTIONS_DLQ_URL;
    if (!queueUrl || !dlqUrl) {
      throw new Error("SQS_TRANSACTIONS_QUEUE_URL and SQS_TRANSACTIONS_DLQ_URL are required");
    }
    this.queueUrl = queueUrl;
    this.dlqUrl = dlqUrl;
    this.baseRetrySeconds = Number(process.env.SQS_RETRY_BASE_SECONDS ?? 5);
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint: process.env.SQS_ENDPOINT || undefined,
    });
    this.running = this.loop(this.client);
  }

  async onApplicationShutdown(): Promise<void> {
    this.abort.abort();
    await this.running;
    this.client?.destroy();
  }

  private async loop(client: SQSClient): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        const response = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
            MessageSystemAttributeNames: ["ApproximateReceiveCount", "MessageGroupId"],
          }),
          { abortSignal: this.abort.signal },
        );
        for (const message of response.Messages ?? []) {
          if (this.abort.signal.aborted) {
            await this.release(client, message);
          } else {
            await this.handle(client, message);
          }
        }
      } catch (error) {
        if (this.abort.signal.aborted) {
          return;
        }
        this.logger.error({ message: "queue.receive_failed", error: describe(error) });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async handle(client: SQSClient, message: Message): Promise<void> {
    try {
      await this.consumer.consume(message.Body ?? "");
    } catch (error) {
      if (error instanceof PermanentMessageError) {
        await this.sendToDlq(client, message, error.message);
        await this.acknowledge(client, message);
      } else {
        await this.retryLater(client, message, error);
      }
      return;
    }
    await this.acknowledge(client, message);
  }

  private async acknowledge(client: SQSClient, message: Message): Promise<void> {
    await client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  }

  private async sendToDlq(client: SQSClient, message: Message, reason: string): Promise<void> {
    this.metrics.messageSentToDlq();
    this.logger.warn({ message: "message.sent_to_dlq", sqsMessageId: message.MessageId, reason });
    await client.send(
      new SendMessageCommand({
        QueueUrl: this.dlqUrl,
        MessageBody: message.Body ?? "",
        MessageGroupId: message.Attributes?.MessageGroupId ?? "invalid",
        MessageDeduplicationId: message.MessageId,
        MessageAttributes: { reason: { DataType: "String", StringValue: reason.slice(0, 256) } },
      }),
    );
  }

  private async retryLater(client: SQSClient, message: Message, error: unknown): Promise<void> {
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? 1);
    this.metrics.retryScheduled("sqs");
    const delay = Math.min(this.baseRetrySeconds * 2 ** (receiveCount - 1), MAX_RETRY_SECONDS);
    this.logger.warn({
      message: "message.retry_scheduled",
      sqsMessageId: message.MessageId,
      receiveCount,
      delaySeconds: delay,
      error: describe(error),
    });
    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: delay,
      }),
    );
  }

  private async release(client: SQSClient, message: Message): Promise<void> {
    await client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: 0,
      }),
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
