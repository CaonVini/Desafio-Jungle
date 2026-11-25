import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "wallets" })
export class WalletOrmEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ name: "player_id", type: "uuid" })
  playerId!: string;

  @Column({ type: "char", length: 3 })
  currency!: string;

  @Column({ type: "numeric", precision: 19, scale: 2 })
  balance!: string;

  @Column({ type: "integer" })
  version!: number;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}