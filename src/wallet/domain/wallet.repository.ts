import { TransactionContext } from "../../shared/domain/transaction-manager";
import { Wallet } from "./wallet";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

export abstract class WalletRepository {
  abstract insert(tx: TransactionContext, wallet: Wallet): Promise<void>;
  abstract findById(tx: TransactionContext, id: string): Promise<Wallet | undefined>;
  abstract findByIdForUpdate(tx: TransactionContext, id: string): Promise<Wallet | undefined>;
  abstract updateBalance(tx: TransactionContext, wallet: Wallet, expectedVersion: number): Promise<void>;
  abstract addLedgerEntry(tx: TransactionContext, entry: WalletLedgerEntry): Promise<void>;
}