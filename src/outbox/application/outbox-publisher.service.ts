import { Injectable, Logger } from "@nestjs/common";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { MessagePublisher } from "../domain/message-publisher";
import { OutboxRepository } from "../domain/outbox.repository";

export const OUTBOX_BATCH_SIZE = 10;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export interface PublishBatchResult {
  claimed: number;
  published: number;
  failed: number;
}

export function backoffDelayMs(failedAttempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (failedAttempts - 1), MAX_BACKOFF_MS);
}

@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    private readonly transactions: TransactionManager,
    private readonly outbox: OutboxRepository,
    private readonly publisher: MessagePublisher,
  ) {}

  async publishBatch(now: Date = new Date(), limit: number = OUTBOX_BATCH_SIZE): Promise<PublishBatchResult> {
    return this.transactions.run(async (tx) => {
      const events = await this.outbox.claimPending(tx, now, limit);
      let published = 0;
      let failed = 0;

      for (const event of events) {
        try {
          await this.publisher.publish({ id: event.id, type: event.eventType, payload: event.payload });
        } catch (error) {
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          const nextAttemptAt = new Date(now.getTime() + backoffDelayMs(event.attempts + 1));
          await this.outbox.markFailed(tx, event.id, message, nextAttemptAt);
          this.logger.warn(
            `Falha ao publicar evento ${event.id} (tentativa ${event.attempts + 1}): ${message}`,
          );
          break;
        }
        await this.outbox.markPublished(tx, event.id, new Date());
        published++;
      }

      return { claimed: events.length, published, failed };
    });
  }
}