import { Injectable } from "@nestjs/common";
import { DomainError } from "../../shared/domain/domain-error";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { asManager, isUniqueViolation } from "../../shared/infra/database/typeorm-helpers";
import { Wallet } from "../domain/wallet";
import { WalletLedgerEntry } from "../domain/wallet-ledger-entry";
import { WalletRepository } from "../domain/wallet.repository";
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
}