import { Injectable } from "@nestjs/common";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { asManager } from "../../shared/infra/database/typeorm-helpers";
import { NewOutboxEvent, OutboxStats, PendingOutboxEvent } from "../domain/outbox-event";
import { OutboxRepository } from "../domain/outbox.repository";
import { OutboxEventOrmEntity } from "./outbox-event.orm-entity";

const MAX_ERROR_LENGTH = 500;

interface PendingRow {
  id: string;
  transaction_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

@Injectable()
export class TypeOrmOutboxRepository extends OutboxRepository {
  async append(tx: TransactionContext, event: NewOutboxEvent): Promise<void> {
    await asManager(tx)
      .createQueryBuilder()
      .insert()
      .into(OutboxEventOrmEntity)
      .values({
        id: event.id,
        transactionId: event.transactionId,
        eventType: event.eventType,
        payload: event.payload,
        status: "PENDING",
        attempts: 0,
        lastError: null,
        nextAttemptAt: event.createdAt,
        createdAt: event.createdAt,
        publishedAt: null,
      })
      .orIgnore()
      .execute();
  }

  async claimPending(
    tx: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<PendingOutboxEvent[]> {
    const rows: PendingRow[] = await asManager(tx).query(
      `SELECT id, transaction_id, event_type, payload, attempts
         FROM outbox_events
        WHERE status = 'PENDING' AND next_attempt_at <= $1
        ORDER BY next_attempt_at, created_at
        LIMIT $2
          FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transaction_id,
      eventType: row.event_type,
      payload: row.payload,
      attempts: row.attempts,
    }));
  }

  async markPublished(tx: TransactionContext, id: string, publishedAt: Date): Promise<void> {
    await asManager(tx).query(
      `UPDATE outbox_events
          SET status = 'PUBLISHED', published_at = $2, attempts = attempts + 1, last_error = NULL
        WHERE id = $1`,
      [id, publishedAt],
    );
  }

  async markFailed(
    tx: TransactionContext,
    id: string,
    error: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await asManager(tx).query(
      `UPDATE outbox_events
          SET attempts = attempts + 1, last_error = $2, next_attempt_at = $3
        WHERE id = $1`,
      [id, error.slice(0, MAX_ERROR_LENGTH), nextAttemptAt],
    );
  }

  async pendingStats(tx: TransactionContext, now: Date): Promise<OutboxStats> {
    const rows: { pending: number; age: number }[] = await asManager(tx).query(
      `SELECT count(*)::int AS pending,
              COALESCE(GREATEST(EXTRACT(EPOCH FROM ($1::timestamptz - MIN(created_at))), 0), 0)::float AS age
         FROM outbox_events
        WHERE status = 'PENDING'`,
      [now],
    );
    return { pending: rows[0]?.pending ?? 0, oldestPendingAgeSeconds: rows[0]?.age ?? 0 };
  }
}
