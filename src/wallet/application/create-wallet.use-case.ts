import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { hashPayload } from "../../shared/application/payload-hash";
import { Money, MoneyProps } from "../../shared/domain/money";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { WagerTransaction } from "../../wagering/domain/wager-transaction";
import { WagerTransactionKind } from "../../wagering/domain/wager-transaction.enums";
import { WagerTransactionRepository } from "../../wagering/domain/wager-transaction.repository";
import { LedgerDirection } from "../domain/ledger-direction";
import { Wallet } from "../domain/wallet";
import { WalletLedgerEntry } from "../domain/wallet-ledger-entry";
import { WalletRepository } from "../domain/wallet.repository";
import { toWalletOutput, WalletOutput } from "./wallet.output";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
  ) {}

  async execute(input: CreateWalletInput): Promise<WalletOutput> {
    const initialBalance = Money.from(input.initialBalance);
    const now = new Date();

    return this.transactionManager.run(async (tx) => {
      const wallet = Wallet.open({
        id: uuidv7(),
        playerId: input.playerId,
        initialBalance,
        now,
      });
      await this.wallets.insert(tx, wallet);

      if (initialBalance.isPositive()) {
        const opening = WagerTransaction.create({
          id: uuidv7(),
          providerId: "internal",
          externalTransactionId: `opening:${wallet.id}`,
          idempotencyKey: `internal:opening:${wallet.id}`,
          payloadHash: hashPayload({ walletId: wallet.id, money: initialBalance.toJSON() }),
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: "opening",
          gameId: "opening",
          kind: WagerTransactionKind.Opening,
          money: initialBalance,
          createdAt: now,
        });
        opening.markProcessed(undefined, now);
        await this.transactions.insertIfAbsent(tx, opening);

        const entry = WalletLedgerEntry.create({
          id: uuidv7(),
          walletId: wallet.id,
          transactionId: opening.id,
          direction: LedgerDirection.CREDIT,
          money: initialBalance,
          balanceBefore: Money.zero(wallet.currency),
          balanceAfter: initialBalance,
          createdAt: now,
        });
        await this.wallets.addLedgerEntry(tx, entry);
      }

      return toWalletOutput(wallet);
    });
  }
}