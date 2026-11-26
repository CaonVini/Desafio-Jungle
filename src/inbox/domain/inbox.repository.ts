import { TransactionContext } from "../../shared/domain/transaction-manager";
import { ReceivedEvent } from "./received-event";

export abstract class InboxRepository {
  abstract registerIfAbsent(
    tx: TransactionContext,
    event: ReceivedEvent,
    processedAt: Date,
  ): Promise<boolean>;
}