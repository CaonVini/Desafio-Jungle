import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { InboxConsumerService } from "../application/inbox-consumer.service";

@Injectable()
export class SqsConsumerWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumerWorker.name);
  private client: SQSClient | undefined;
  private queueUrl = "";
  private running: Promise<void> = Promise.resolve();
  private readonly abort = new AbortController();

  constructor(private readonly consumer: InboxConsumerService) {}

  onApplicationBootstrap(): void {
    if (process.env.SQS_CONSUMER_ENABLED === "false") {
      return;
    }
    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
      throw new Error("SQS_QUEUE_URL is required (see .env.example)");
    }
    this.queueUrl = queueUrl;
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
          }),
          { abortSignal: this.abort.signal },
        );
        for (const message of response.Messages ?? []) {
          await this.handle(client, message);
        }
      } catch (error) {
        if (this.abort.signal.aborted) {
          return;
        }
        this.logger.error(
          `Erro ao ler a fila: ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async handle(client: SQSClient, message: Message): Promise<void> {
    try {
      await this.consumer.consume(message.Body ?? "");
    } catch (error) {
      // Sem delete: a mensagem volta para a fila e, depois de 5 recebimentos, o SQS a move para a DLQ.
      this.logger.warn(
        `Falha ao processar mensagem ${message.MessageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }
}