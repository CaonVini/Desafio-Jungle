import { TransactionContext } from "../../shared/domain/transaction-manager";
import { NewOutboxEvent, OutboxStats, PendingOutboxEvent } from "./outbox-event";

export abstract class OutboxRepository {
  abstract append(tx: TransactionContext, event: NewOutboxEvent): Promise<void>;

  abstract claimPending(
    tx: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<PendingOutboxEvent[]>;

  abstract markPublished(tx: TransactionContext, id: string, publishedAt: Date): Promise<void>;

  abstract markFailed(
    tx: TransactionContext,
    id: string,
    error: string,
    nextAttemptAt: Date,
  ): Promise<void>;

  abstract pendingStats(tx: TransactionContext, now: Date): Promise<OutboxStats>;
}
