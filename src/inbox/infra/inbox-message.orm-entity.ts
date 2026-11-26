import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "inbox_messages" })
export class InboxMessageOrmEntity {
  @PrimaryColumn({ name: "message_id", type: "uuid" })
  messageId!: string;

  @Column({ name: "event_type", type: "varchar", length: 64 })
  eventType!: string;

  @Column({ name: "processed_at", type: "timestamptz" })
  processedAt!: Date;
}