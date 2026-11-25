import { MessagePublisher, OutboundMessage } from "../../src/outbox/domain/message-publisher";

export class FakeMessagePublisher extends MessagePublisher {
  readonly sent: OutboundMessage[] = [];
  failing = false;

  async publish(message: OutboundMessage): Promise<void> {
    if (this.failing) {
      throw new Error("broker indisponivel");
    }
    this.sent.push(message);
  }
}