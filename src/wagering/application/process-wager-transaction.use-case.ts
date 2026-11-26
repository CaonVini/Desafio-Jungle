import { Injectable, Logger } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { MetricsService } from "../../metrics/metrics.service";
import { EventContext, IntegrationEvent } from "../../outbox/domain/integration-event";
import { OutboxRepository } from "../../outbox/domain/outbox.repository";
import { hashPayload } from "../../shared/application/payload-hash";
import { DomainError } from "../../shared/domain/domain-error";
import { Money, MoneyProps } from "../../shared/domain/money";
import { TransactionContext, TransactionManager } from "../../shared/domain/transaction-manager";
import { currentCorrelationId } from "../../shared/logging/correlation";
import { InsufficientFundsError } from "../../wallet/domain/insufficient-funds.error";
import { LedgerDirection } from "../../wallet/domain/ledger-direction";
import { Wallet } from "../../wallet/domain/wallet";
import { WalletLedgerEntry } from "../../wallet/domain/wallet-ledger-entry";
import { WalletRepository } from "../../wallet/domain/wallet.repository";
import { WalletBalanceChanged } from "../../wallet/events/wallet-balance-changed.event";
import { WagerTransaction } from "../domain/wager-transaction";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../domain/wager-transaction.enums";
import { MAX_REFERENCE_ATTEMPTS, referenceRetryDelayMs } from "../domain/reference-retry-policy";
import { WagerTransactionRepository } from "../domain/wager-transaction.repository";
import { WagerTransactionPendingReference } from "../events/wager-transaction-pending-reference.event";
import { WagerTransactionProcessed } from "../events/wager-transaction-processed.event";
import { WagerTransactionRejected } from "../events/wager-transaction-rejected.event";
import { logTransaction } from "./transaction-log";
import { toWagerTransactionOutput, WagerTransactionOutput } from "./wager-transaction.output";

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

interface PreparedInput {
  money: Money;
  payloadHash: string;
}

export interface ProcessWagerTransactionResult {
  transaction: WagerTransactionOutput;
  idempotentReplay: boolean;
}

@Injectable()
export class ProcessWagerTransactionUseCase {
  private readonly logger = new Logger(ProcessWagerTransactionUseCase.name);

  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly wallets: WalletRepository,
    private readonly transactions: WagerTransactionRepository,
    private readonly outbox: OutboxRepository,
    private readonly metrics: MetricsService,
  ) {}

  async execute(input: ProcessWagerTransactionInput): Promise<ProcessWagerTransactionResult> {
    const startedAt = performance.now();
    const prepared = this.prepare(input);
    const result = await this.guarded(() =>
      this.transactionManager.run((tx) => this.process(tx, input, prepared)),
    );
    this.metrics.recordResult(
      result.transaction.status,
      result.idempotentReplay,
      performance.now() - startedAt,
    );
    logTransaction(this.logger, result.transaction, { idempotentReplay: result.idempotentReplay });
    return result;
  }

  executeWithin(
    tx: TransactionContext,
    input: ProcessWagerTransactionInput,
  ): Promise<ProcessWagerTransactionResult> {
    return this.guarded(() => this.process(tx, input, this.prepare(input)));
  }

  async retryPendingReference(
    transactionId: string,
    now: Date = new Date(),
  ): Promise<WagerTransactionOutput | undefined> {
    return this.guarded(() => this.retryWithin(transactionId, now));
  }

  private retryWithin(
    transactionId: string,
    now: Date,
  ): Promise<WagerTransactionOutput | undefined> {
    return this.transactionManager.run(async (tx) => {
      const candidate = await this.transactions.findById(tx, transactionId);
      if (candidate?.status !== WagerTransactionStatus.PendingReference) {
        return undefined;
      }

      const wallet = await this.wallets.findByIdForUpdate(tx, candidate.walletId);
      const transaction = await this.transactions.findById(tx, transactionId);
      const stillDue =
        transaction?.status === WagerTransactionStatus.PendingReference &&
        (transaction.nextAttemptAt === undefined || transaction.nextAttemptAt <= now);
      if (!wallet || !transaction || !stillDue) {
        return undefined;
      }

      const expectedVersion = wallet.version;
      const entry = await this.settle(tx, wallet, transaction, now);
      transaction.observeBalance(wallet.balance);
      await this.transactions.update(tx, transaction);

      if (entry) {
        await this.wallets.addLedgerEntry(tx, entry);
        await this.wallets.updateBalance(tx, wallet, expectedVersion);
      }

      await this.recordOutcome(tx, wallet, transaction, entry, now, false);
      return toWagerTransactionOutput(transaction);
    });
  }

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.metrics.failure(error);
      throw error;
    }
  }

  private prepare(input: ProcessWagerTransactionInput): PreparedInput {
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
    return { money, payloadHash };
  }

  private async process(
    tx: TransactionContext,
    input: ProcessWagerTransactionInput,
    { money, payloadHash }: PreparedInput,
  ): Promise<ProcessWagerTransactionResult> {
    const wallet = await this.wallets.findByIdForUpdate(tx, input.walletId);
    if (!wallet) {
      throw new DomainError("Wallet not found", "WALLET_NOT_FOUND");
    }
    const now = new Date();

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
    transaction.observeBalance(wallet.balance);

    const inserted = await this.transactions.insertIfAbsent(tx, transaction);
    if (!inserted) {
      throw new DomainError("Transaction already registered", "IDEMPOTENCY_CONFLICT");
    }

    if (entry) {
      await this.wallets.addLedgerEntry(tx, entry);
      await this.wallets.updateBalance(tx, wallet, expectedVersion);
    }

    await this.recordOutcome(tx, wallet, transaction, entry, now, true);

    return { transaction: toWagerTransactionOutput(transaction), idempotentReplay: false };
  }

  private async recordOutcome(
    tx: TransactionContext,
    wallet: Wallet,
    transaction: WagerTransaction,
    entry: WalletLedgerEntry | undefined,
    now: Date,
    firstAttempt: boolean,
  ): Promise<void> {
    const context: EventContext = {
      correlationId: currentCorrelationId() ?? uuidv7(),
      occurredAt: now,
    };

    const outcome = this.outcomeEvent(transaction, context, firstAttempt);
    if (outcome) {
      await this.appendEvent(tx, transaction.id, outcome);
    }
    if (entry) {
      const balanceChanged = WalletBalanceChanged.from(wallet, entry, {
        ...context,
        causationId: transaction.id,
      });
      await this.appendEvent(tx, transaction.id, balanceChanged);
    }
  }

  private outcomeEvent(
    transaction: WagerTransaction,
    context: EventContext,
    firstAttempt: boolean,
  ): IntegrationEvent<unknown> | undefined {
    switch (transaction.status) {
      case WagerTransactionStatus.Processed:
        return WagerTransactionProcessed.from(transaction, context);
      case WagerTransactionStatus.Rejected:
        return WagerTransactionRejected.from(transaction, context);
      case WagerTransactionStatus.PendingReference:
        return firstAttempt
          ? WagerTransactionPendingReference.from(transaction, context)
          : undefined;
      default:
        return undefined;
    }
  }

  private async appendEvent(
    tx: TransactionContext,
    transactionId: string,
    event: IntegrationEvent<unknown>,
  ): Promise<void> {
    await this.outbox.append(tx, {
      id: event.eventId,
      transactionId,
      eventType: event.eventType,
      payload: event.toJSON(),
      createdAt: event.occurredAt,
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
        if (transaction.referenceAttempts >= MAX_REFERENCE_ATTEMPTS) {
          transaction.reject(
            reference ? FailureCode.ReferenceNotProcessed : FailureCode.ReferenceNotFound,
          );
          return undefined;
        }
        const delay = referenceRetryDelayMs(transaction.referenceAttempts + 1);
        transaction.markPendingReference(new Date(now.getTime() + delay));
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
