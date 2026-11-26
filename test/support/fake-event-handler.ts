import { EventHandler } from "../../src/inbox/domain/event-handler";
import { ReceivedEvent } from "../../src/inbox/domain/received-event";
import { TransactionContext } from "../../src/shared/domain/transaction-manager";

export class FakeEventHandler extends EventHandler {
  readonly handled: ReceivedEvent[] = [];
  failing = false;

  async handle(_tx: TransactionContext, event: ReceivedEvent): Promise<void> {
    if (this.failing) {
      throw new Error("handler falhou");
    }
    this.handled.push(event);
  }
}