import { Injectable } from "@nestjs/common";
import { DomainError } from "../../shared/domain/domain-error";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { asManager, isUniqueViolation } from "../../shared/infra/database/typeorm-helpers";
import { Wallet } from "../domain/wallet";
import { WalletLedgerEntry } from "../domain/wallet-ledger-entry";
import {
  LedgerPosition,
  LedgerRow,
  LedgerTotals,
  WalletRepository,
} from "../domain/wallet.repository";
import { WalletLedgerEntryOrmEntity } from "./wallet-ledger-entry.orm-entity";
import { WalletMapper } from "./wallet.mapper";
import { WalletOrmEntity } from "./wallet.orm-entity";

@Injectable()
export class TypeOrmWalletRepository extends WalletRepository {
  async insert(tx: TransactionContext, wallet: Wallet): Promise<void> {
    try {
      await asManager(tx).insert(WalletOrmEntity, WalletMapper.toOrm(wallet));
    } catch (error) {
      if (isUniqueViolation(error, "uq_wallets_player_currency")) {
        throw new DomainError(
          "Wallet already exists for this player and currency",
          "WALLET_ALREADY_EXISTS",
        );
      }
      throw error;
    }
  }

  async findById(tx: TransactionContext, id: string): Promise<Wallet | undefined> {
    const entity = await asManager(tx).findOne(WalletOrmEntity, { where: { id } });
    return entity ? WalletMapper.toDomain(entity) : undefined;
  }

  async findByIdForUpdate(tx: TransactionContext, id: string): Promise<Wallet | undefined> {
    const entity = await asManager(tx).findOne(WalletOrmEntity, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    return entity ? WalletMapper.toDomain(entity) : undefined;
  }

  async updateBalance(tx: TransactionContext, wallet: Wallet, expectedVersion: number): Promise<void> {
    const result = await asManager(tx).update(
      WalletOrmEntity,
      { id: wallet.id, version: expectedVersion },
      { balance: wallet.balance.toString() },
    );
    if (!result.affected) {
      throw new DomainError("Wallet was modified concurrently", "WALLET_CONCURRENT_UPDATE");
    }
  }

  async addLedgerEntry(tx: TransactionContext, entry: WalletLedgerEntry): Promise<void> {
    await asManager(tx).insert(WalletLedgerEntryOrmEntity, WalletMapper.ledgerEntryToOrm(entry));
  }

  async ledgerTotals(tx: TransactionContext, walletId: string): Promise<LedgerTotals | undefined> {
    const rows: {
      currency: string;
      stored: string;
      calculated: string;
      difference: string;
      entries: number;
    }[] = await asManager(tx).query(
      `SELECT w.currency,
              w.balance::text AS stored,
              COALESCE(l.total, 0)::numeric(19,2)::text AS calculated,
              (w.balance - COALESCE(l.total, 0))::numeric(19,2)::text AS difference,
              COALESCE(l.entries, 0)::int AS entries
         FROM wallets w
         LEFT JOIN (
                SELECT wallet_id,
                       SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS total,
                       COUNT(*) AS entries
                  FROM wallet_ledger_entries
                 WHERE wallet_id = $1
                 GROUP BY wallet_id
              ) l ON l.wallet_id = w.id
        WHERE w.id = $1`,
      [walletId],
    );
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      currency: row.currency,
      storedBalance: row.stored,
      calculatedBalance: row.calculated,
      difference: row.difference,
      checkedEntries: row.entries,
    };
  }

  async listLedger(
    tx: TransactionContext,
    walletId: string,
    limit: number,
    after?: LedgerPosition,
  ): Promise<LedgerRow[]> {
    const params: unknown[] = [walletId];
    let seek = "";
    if (after) {
      params.push(after.timestamp, after.id);
      seek = "AND (created_at, id) < ($2::timestamptz, $3::uuid)";
    }
    params.push(limit);

    const rows: Record<string, string | Date>[] = await asManager(tx).query(
      `SELECT id,
              transaction_id,
              direction,
              amount::text AS amount,
              currency,
              balance_before::text AS balance_before,
              balance_after::text AS balance_after,
              created_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_timestamp
         FROM wallet_ledger_entries
        WHERE wallet_id = $1 ${seek}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );

    return rows.map((row) => ({
      id: row.id as string,
      transactionId: row.transaction_id as string,
      direction: row.direction as string,
      amount: row.amount as string,
      currency: row.currency as string,
      balanceBefore: row.balance_before as string,
      balanceAfter: row.balance_after as string,
      createdAt: row.created_at as Date,
      position: { timestamp: row.position_timestamp as string, id: row.id as string },
    }));
  }
}
