import { TransactionContext } from "../../shared/domain/transaction-manager";
import { Wallet } from "./wallet";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

export interface LedgerTotals {
  currency: string;
  storedBalance: string;
  calculatedBalance: string;
  difference: string;
  checkedEntries: number;
}

export interface LedgerPosition {
  timestamp: string;
  id: string;
}

export interface LedgerRow {
  id: string;
  transactionId: string;
  direction: string;
  amount: string;
  currency: string;
  balanceBefore: string;
  balanceAfter: string;
  createdAt: Date;
  position: LedgerPosition;
}

export abstract class WalletRepository {
  abstract insert(tx: TransactionContext, wallet: Wallet): Promise<void>;
  abstract findById(tx: TransactionContext, id: string): Promise<Wallet | undefined>;
  abstract findByIdForUpdate(tx: TransactionContext, id: string): Promise<Wallet | undefined>;
  abstract updateBalance(tx: TransactionContext, wallet: Wallet, expectedVersion: number): Promise<void>;
  abstract addLedgerEntry(tx: TransactionContext, entry: WalletLedgerEntry): Promise<void>;
  abstract ledgerTotals(
    tx: TransactionContext,
    walletId: string,
  ): Promise<LedgerTotals | undefined>;
  abstract listLedger(
    tx: TransactionContext,
    walletId: string,
    limit: number,
    after?: LedgerPosition,
  ): Promise<LedgerRow[]>;
}
