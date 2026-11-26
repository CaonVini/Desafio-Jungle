import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "inbox_messages" })
export class InboxMessageOrmEntity {
  @PrimaryColumn({ name: "consumer_name", type: "varchar", length: 64 })
  consumerName!: string;

  @PrimaryColumn({ name: "message_id", type: "varchar", length: 128 })
  messageId!: string;

  @Column({ name: "message_type", type: "varchar", length: 64 })
  messageType!: string;

  @Column({ name: "received_at", type: "timestamptz" })
  receivedAt!: Date;
}
