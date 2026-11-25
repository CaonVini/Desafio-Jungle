import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { LedgerDirection } from "../../wallet/domain/ledger-direction";
import { InvalidTransactionStateError } from "./invalid-transaction-state.error";
import { FailureCode, WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.enums";

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  referenceAttempts: number;
  nextAttemptAt?: Date;
}

export class WagerTransaction {
  private static readonly allowedReferenceKinds: Partial<
    Record<WagerTransactionKind, WagerTransactionKind[]>
  > = {
    [WagerTransactionKind.Win]: [WagerTransactionKind.Bet],
    [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
    [WagerTransactionKind.Rollback]: [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
    ],
  };

  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _referenceAttempts = 0,
    private _nextAttemptAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const needsReference =
      props.kind === WagerTransactionKind.Refund || props.kind === WagerTransactionKind.Rollback;
    if (needsReference && !props.referenceExternalTransactionId) {
      throw new DomainError("Reference is required for this kind", "REFERENCE_REQUIRED");
    }
    if (props.kind !== WagerTransactionKind.Loss && !props.money.isPositive()) {
      throw new DomainError("Amount must be positive", "NON_POSITIVE_AMOUNT");
    }
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt ?? new Date(),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.referenceAttempts,
      state.nextAttemptAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal("be processed");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._nextAttemptAt = undefined;
  }

  markPendingReference(nextAttemptAt: Date): void {
    this.assertNotTerminal("wait for its reference");
    this._status = WagerTransactionStatus.PendingReference;
    this._referenceAttempts += 1;
    this._nextAttemptAt = nextAttemptAt;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal("be rejected");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._nextAttemptAt = undefined;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal("be failed");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._nextAttemptAt = undefined;
  }

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Bet:
        return LedgerDirection.DEBIT;
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Opening:
        return LedgerDirection.CREDIT;
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new DomainError("Rollback needs its reference to define the direction", "REFERENCE_REQUIRED");
        }
        return reference.ledgerDirectionFor() === LedgerDirection.DEBIT
          ? LedgerDirection.CREDIT
          : LedgerDirection.DEBIT;
      }
      case WagerTransactionKind.Loss:
        throw new DomainError("Loss does not affect the balance", "NO_LEDGER_DIRECTION");
    }
  }

  checkReference(reference: WagerTransaction): FailureCode | undefined {
    const allowed = WagerTransaction.allowedReferenceKinds[this.kind];
    if (!allowed || !allowed.includes(reference.kind)) {
      return FailureCode.InvalidReferenceKind;
    }
    if (!this.sameContextAs(reference)) {
      return FailureCode.ReferenceMismatch;
    }
    if (reference.status !== WagerTransactionStatus.Processed) {
      return FailureCode.ReferenceNotProcessed;
    }
    if (this.requiresReference() && !this.money.equals(reference.money)) {
      return FailureCode.ReferenceAmountMismatch;
    }
    return undefined;
  }

  private sameContextAs(other: WagerTransaction): boolean {
    return (
      this.providerId === other.providerId &&
      this.playerId === other.playerId &&
      this.walletId === other.walletId &&
      this.roundId === other.roundId &&
      this.money.currency === other.money.currency
    );
  }

  private assertNotTerminal(action: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this.id, this._status, action);
    }
  }
}