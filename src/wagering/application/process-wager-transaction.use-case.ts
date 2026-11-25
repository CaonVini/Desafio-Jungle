import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { hashPayload } from "../../shared/application/payload-hash";
import { DomainError } from "../../shared/domain/domain-error";
import { Money, MoneyProps } from "../../shared/domain/money";
import { TransactionContext, TransactionManager } from "../../shared/domain/transaction-manager";
import { InsufficientFundsError } from "../../wallet/domain/insufficient-funds.error";
import { LedgerDirection } from "../../wallet/domain/ledger-direction";
import { Wallet } from "../../wallet/domain/wallet";
import { WalletLedgerEntry } from "../../wallet/domain/wallet-ledger-entry";
import { WalletRepository } from "../../wallet/domain/wallet.repository";
import { WagerTransaction } from "../domain/wager-transaction";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../domain/wager-transaction.enums";
import { WagerTransactionRepository } from "../domain/wager-transaction.repository";
import { toWagerTransactionOutput, WagerTransactionOutput } from "./wager-transaction.output";

const REFERENCE_RETRY_DELAY_MS = 5_000;

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionResult {
  transaction: WagerTransactionOutput;
  idempotentReplay: boolean;
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
  ) {}

  async execute(input: ProcessWagerTransactionInput): Promise<ProcessWagerTransactionResult> {
    const money = Money.from(input.money);
    const payloadHash = hashPayload({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      walletId: input.walletId,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });
    const now = new Date();

    return this.transactionManager.run(async (tx) => {
      const wallet = await this.wallets.findByIdForUpdate(tx, input.walletId);
      if (!wallet) {
        throw new DomainError("Wallet not found", "WALLET_NOT_FOUND");
      }

      const existing =
        (await this.transactions.findByProviderAndIdempotencyKey(
          tx,
          input.providerId,
          input.idempotencyKey,
        )) ??
        (await this.transactions.findByProviderAndExternalId(
          tx,
          input.providerId,
          input.externalTransactionId,
        ));

      if (existing) {
        if (!existing.matchesPayload(payloadHash)) {
          throw new DomainError(
            "Idempotency key or external transaction id already used with a different payload",
            "IDEMPOTENCY_CONFLICT",
          );
        }
        return { transaction: toWagerTransactionOutput(existing), idempotentReplay: true };
      }

      const transaction = WagerTransaction.create({
        id: uuidv7(),
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
        createdAt: now,
      });

      const expectedVersion = wallet.version;
      const entry = await this.settle(tx, wallet, transaction, now);

      const inserted = await this.transactions.insertIfAbsent(tx, transaction);
      if (!inserted) {
        throw new DomainError("Transaction already registered", "IDEMPOTENCY_CONFLICT");
      }

      if (entry) {
        await this.wallets.addLedgerEntry(tx, entry);
        await this.wallets.updateBalance(tx, wallet, expectedVersion);
      }

      return { transaction: toWagerTransactionOutput(transaction), idempotentReplay: false };
    });
  }

  private async settle(
    tx: TransactionContext,
    wallet: Wallet,
    transaction: WagerTransaction,
    now: Date,
  ): Promise<WalletLedgerEntry | undefined> {
    if (transaction.playerId !== wallet.playerId) {
      transaction.reject(FailureCode.WalletPlayerMismatch);
      return undefined;
    }
    if (transaction.money.currency !== wallet.currency) {
      transaction.reject(FailureCode.CurrencyMismatch);
      return undefined;
    }

    let reference: WagerTransaction | undefined;
    if (transaction.referenceExternalTransactionId) {
      reference = await this.transactions.findByProviderAndExternalId(
        tx,
        transaction.providerId,
        transaction.referenceExternalTransactionId,
      );

      if (!reference || reference.status === WagerTransactionStatus.PendingReference) {
        transaction.markPendingReference(new Date(now.getTime() + REFERENCE_RETRY_DELAY_MS));
        return undefined;
      }

      const failure = transaction.checkReference(reference);
      if (failure) {
        transaction.reject(failure);
        return undefined;
      }

      if (
        transaction.requiresReference() &&
        (await this.transactions.hasProcessedReversal(tx, reference.id, transaction.kind))
      ) {
        transaction.reject(FailureCode.AlreadyReversed);
        return undefined;
      }
    }

    if (!transaction.affectsBalance()) {
      transaction.markProcessed(reference?.id, now);
      return undefined;
    }

    const direction = transaction.ledgerDirectionFor(reference);
    const movement = {
      entryId: uuidv7(),
      transactionId: transaction.id,
      money: transaction.money,
      at: now,
    };

    let entry: WalletLedgerEntry;
    try {
      entry =
        direction === LedgerDirection.DEBIT ? wallet.debit(movement) : wallet.credit(movement);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        transaction.reject(
          transaction.kind === WagerTransactionKind.Rollback
            ? FailureCode.ReversalInsufficientFunds
            : FailureCode.InsufficientFunds,
        );
        return undefined;
      }
      throw error;
    }

    transaction.markProcessed(reference?.id, now);
    return entry;
  }
}