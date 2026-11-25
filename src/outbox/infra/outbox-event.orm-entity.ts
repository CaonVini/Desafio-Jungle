import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "outbox_events" })
export class OutboxEventOrmEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ name: "transaction_id", type: "uuid" })
  transactionId!: string;

  @Column({ name: "event_type", type: "varchar", length: 64 })
  eventType!: string;

  @Column({ type: "jsonb" })
  payload!: object;

  @Column({ type: "varchar", length: 16 })
  status!: string;

  @Column({ type: "integer" })
  attempts!: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError!: string | null;

  @Column({ name: "next_attempt_at", type: "timestamptz" })
  nextAttemptAt!: Date;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;
}