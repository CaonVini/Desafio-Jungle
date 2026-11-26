import { Injectable } from "@nestjs/common";
import { validate as isUuid } from "uuid";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { EventHandler } from "../domain/event-handler";
import { InboxRepository } from "../domain/inbox.repository";
import { ReceivedEvent } from "../domain/received-event";

export type ConsumeResult = "PROCESSED" | "DUPLICATE";

@Injectable()
export class InboxConsumerService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly inbox: InboxRepository,
    private readonly handler: EventHandler,
  ) {}

  async consume(body: string): Promise<ConsumeResult> {
    const event = parseEvent(body);

    return this.transactions.run(async (tx) => {
      const isNew = await this.inbox.registerIfAbsent(tx, event, new Date());
      if (!isNew) {
        return "DUPLICATE";
      }
      await this.handler.handle(tx, event);
      return "PROCESSED";
    });
  }
}

function parseEvent(body: string): ReceivedEvent {
  const data = JSON.parse(body) as Partial<ReceivedEvent>;
  if (typeof data.id !== "string" || !isUuid(data.id) || typeof data.type !== "string") {
    throw new Error("Invalid message: expected { id (uuid), type, payload }");
  }
  return { id: data.id, type: data.type, payload: data.payload ?? {} };
}