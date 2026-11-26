import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { MessagePublisher, OutboundMessage } from "../domain/message-publisher";

const SEND_TIMEOUT_MS = 5_000;

@Injectable()
export class SqsMessagePublisher extends MessagePublisher implements OnModuleDestroy {
  private readonly client: SQSClient;
  private readonly queueUrl: string;

  constructor() {
    super();
    const queueUrl = process.env.SQS_EVENTS_QUEUE_URL;
    if (!queueUrl) {
      throw new Error("SQS_EVENTS_QUEUE_URL is required (see .env.example)");
    }
    this.queueUrl = queueUrl;
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint: process.env.SQS_ENDPOINT || undefined,
    });
  }

  async publish(message: OutboundMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(message),
        MessageAttributes: {
          eventType: { DataType: "String", StringValue: message.type },
        },
      }),
      { abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS) },
    );
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
