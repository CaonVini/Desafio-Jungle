import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "wager_transactions" })
export class WagerTransactionOrmEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ name: "provider_id", type: "varchar", length: 64 })
  providerId!: string;

  @Column({ name: "external_transaction_id", type: "varchar", length: 128 })
  externalTransactionId!: string;

  @Column({ name: "idempotency_key", type: "varchar", length: 256 })
  idempotencyKey!: string;

  @Column({ name: "payload_hash", type: "char", length: 64 })
  payloadHash!: string;

  @Column({ name: "wallet_id", type: "uuid" })
  walletId!: string;

  @Column({ name: "player_id", type: "uuid" })
  playerId!: string;

  @Column({ name: "round_id", type: "varchar", length: 128 })
  roundId!: string;

  @Column({ name: "game_id", type: "varchar", length: 128 })
  gameId!: string;

  @Column({ type: "varchar", length: 16 })
  kind!: string;

  @Column({ type: "numeric", precision: 19, scale: 2 })
  amount!: string;

  @Column({ type: "char", length: 3 })
  currency!: string;

  @Column({ name: "reference_external_transaction_id", type: "varchar", length: 128, nullable: true })
  referenceExternalTransactionId!: string | null;

  @Column({ name: "reference_transaction_id", type: "uuid", nullable: true })
  referenceTransactionId!: string | null;

  @Column({ type: "varchar", length: 24 })
  status!: string;

  @Column({ name: "failure_code", type: "varchar", length: 64, nullable: true })
  failureCode!: string | null;

  @Column({ name: "reference_attempts", type: "integer" })
  referenceAttempts!: number;

  @Column({ name: "next_attempt_at", type: "timestamptz", nullable: true })
  nextAttemptAt!: Date | null;

  @Column({ name: "balance_after", type: "numeric", precision: 19, scale: 2, nullable: true })
  balanceAfter!: string | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "processed_at", type: "timestamptz", nullable: true })
  processedAt!: Date | null;
}