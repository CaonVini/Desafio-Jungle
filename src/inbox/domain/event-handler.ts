import { TransactionContext } from "../../shared/domain/transaction-manager";
import { ReceivedEvent } from "./received-event";

export abstract class EventHandler {
  abstract handle(tx: TransactionContext, event: ReceivedEvent): Promise<void>;
}