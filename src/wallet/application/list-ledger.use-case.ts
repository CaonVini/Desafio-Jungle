import { Injectable } from "@nestjs/common";
import { validate as isUuid } from "uuid";
import { DomainError } from "../../shared/domain/domain-error";
import { MoneyProps } from "../../shared/domain/money";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { LedgerPosition, WalletRepository } from "../domain/wallet.repository";

export const DEFAULT_LEDGER_LIMIT = 50;
export const MAX_LEDGER_LIMIT = 100;

const POSITION_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface LedgerEntryOutput {
  id: string;
  transactionId: string;
  direction: string;
  amount: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPageOutput {
  items: LedgerEntryOutput[];
  nextCursor: string | null;
}

export interface ListLedgerInput {
  walletId: string;
  cursor?: string;
  limit?: number;
}

function encodeCursor(position: LedgerPosition): string {
  return Buffer.from(JSON.stringify({ t: position.timestamp, i: position.id })).toString(
    "base64url",
  );
}

function decodeCursor(cursor: string): LedgerPosition {
  const invalid = new DomainError("cursor is invalid", "INVALID_PAYLOAD");
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const { t, i } = decoded ?? {};
    if (
      typeof t !== "string" ||
      !POSITION_TIMESTAMP.test(t) ||
      Number.isNaN(Date.parse(t)) ||
      typeof i !== "string" ||
      !isUuid(i)
    ) {
      throw invalid;
    }
    return { timestamp: t, id: i };
  } catch {
    throw invalid;
  }
}

@Injectable()
export class ListLedgerUseCase {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly wallets: WalletRepository,
  ) {}

  async execute(input: ListLedgerInput): Promise<LedgerPageOutput> {
    const limit = input.limit ?? DEFAULT_LEDGER_LIMIT;
    const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);

    return this.transactionManager.run(async (tx) => {
      const wallet = await this.wallets.findById(tx, input.walletId);
      if (!wallet) {
        throw new DomainError("Wallet not found", "WALLET_NOT_FOUND");
      }

      const rows = await this.wallets.listLedger(tx, input.walletId, limit + 1, after);
      const page = rows.slice(0, limit);

      return {
        items: page.map((row) => ({
          id: row.id,
          transactionId: row.transactionId,
          direction: row.direction,
          amount: { amount: row.amount, currency: row.currency },
          balanceBefore: { amount: row.balanceBefore, currency: row.currency },
          balanceAfter: { amount: row.balanceAfter, currency: row.currency },
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].position) : null,
      };
    });
  }
}
