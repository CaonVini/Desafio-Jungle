import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "wallet_ledger_entries" })
export class WalletLedgerEntryOrmEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ name: "wallet_id", type: "uuid" })
  walletId!: string;

  @Column({ name: "transaction_id", type: "uuid" })
  transactionId!: string;

  @Column({ type: "varchar", length: 6 })
  direction!: string;

  @Column({ type: "numeric", precision: 19, scale: 2 })
  amount!: string;

  @Column({ type: "char", length: 3 })
  currency!: string;

  @Column({ name: "balance_before", type: "numeric", precision: 19, scale: 2 })
  balanceBefore!: string;

  @Column({ name: "balance_after", type: "numeric", precision: 19, scale: 2 })
  balanceAfter!: string;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}