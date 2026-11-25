import { describe, it, expect } from "bun:test";
import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { LedgerDirection } from "../../wallet/domain/ledger-direction";
import { InvalidTransactionStateError } from "./invalid-transaction-state.error";
import { FailureCode, WagerTransactionKind, WagerTransactionStatus } from "./wager-transaction.enums";
import { CreateWagerTransactionProps, WagerTransaction } from "./wager-transaction";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const at = new Date("2026-01-01T00:00:00Z");

const build = (overrides: Partial<CreateWagerTransactionProps> = {}) =>
  WagerTransaction.create({
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-1",
    idempotencyKey: "provider-a:ext-1",
    payloadHash: "a".repeat(64),
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: brl("25.00"),
    createdAt: at,
    ...overrides,
  });

const processed = (overrides: Partial<CreateWagerTransactionProps> = {}) => {
  const tx = build(overrides);
  tx.markProcessed(undefined, at);
  return tx;
};

const reversal = (kind: WagerTransactionKind, overrides: Partial<CreateWagerTransactionProps> = {}) =>
  build({
    id: "tx-2",
    externalTransactionId: "ext-2",
    idempotencyKey: "provider-a:ext-2",
    kind,
    referenceExternalTransactionId: "ext-1",
    ...overrides,
  });

describe("WagerTransaction", () => {
  describe("criação", () => {
    it("nasce PENDING", () => {
      expect(build().status).toBe(WagerTransactionStatus.Pending);
    });

    it("exige referência em REFUND e ROLLBACK", () => {
      expect(() => build({ kind: WagerTransactionKind.Refund })).toThrow(DomainError);
      expect(() => build({ kind: WagerTransactionKind.Rollback })).toThrow(DomainError);
    });

    it("rejeita valor zero fora do LOSS", () => {
      expect(() => build({ money: brl("0.00") })).toThrow(DomainError);
    });

    it("aceita LOSS com valor zero", () => {
      expect(() => build({ kind: WagerTransactionKind.Loss, money: brl("0.00") })).not.toThrow();
    });

    it("rehydrate não revalida regras", () => {
      const tx = WagerTransaction.rehydrate({
        id: "tx-1",
        providerId: "provider-a",
        externalTransactionId: "ext-1",
        idempotencyKey: "provider-a:ext-1",
        payloadHash: "a".repeat(64),
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "fortune-chimp",
        kind: WagerTransactionKind.Refund,
        money: brl("25.00"),
        createdAt: at,
        status: WagerTransactionStatus.Processed,
        referenceAttempts: 0,
      });
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
    });
  });

  describe("consultas", () => {
    it("LOSS não afeta o saldo", () => {
      expect(build({ kind: WagerTransactionKind.Loss }).affectsBalance()).toBe(false);
      expect(build().affectsBalance()).toBe(true);
    });

    it("só REFUND e ROLLBACK exigem referência", () => {
      expect(reversal(WagerTransactionKind.Refund).requiresReference()).toBe(true);
      expect(reversal(WagerTransactionKind.Rollback).requiresReference()).toBe(true);
      expect(build().requiresReference()).toBe(false);
    });

    it("compara o hash do payload", () => {
      const tx = build();
      expect(tx.matchesPayload("a".repeat(64))).toBe(true);
      expect(tx.matchesPayload("b".repeat(64))).toBe(false);
    });
  });

  describe("direção no ledger", () => {
    it("BET debita, WIN e REFUND creditam", () => {
      expect(build().ledgerDirectionFor()).toBe(LedgerDirection.DEBIT);
      expect(build({ kind: WagerTransactionKind.Win }).ledgerDirectionFor()).toBe(LedgerDirection.CREDIT);
      expect(reversal(WagerTransactionKind.Refund).ledgerDirectionFor()).toBe(LedgerDirection.CREDIT);
    });

    it("ROLLBACK inverte a direção da referência", () => {
      const rollback = reversal(WagerTransactionKind.Rollback);
      expect(rollback.ledgerDirectionFor(build())).toBe(LedgerDirection.CREDIT);
      expect(rollback.ledgerDirectionFor(build({ kind: WagerTransactionKind.Win }))).toBe(LedgerDirection.DEBIT);
      expect(rollback.ledgerDirectionFor(reversal(WagerTransactionKind.Refund))).toBe(LedgerDirection.DEBIT);
    });

    it("ROLLBACK sem referência e LOSS lançam erro", () => {
      expect(() => reversal(WagerTransactionKind.Rollback).ledgerDirectionFor()).toThrow(DomainError);
      expect(() => build({ kind: WagerTransactionKind.Loss }).ledgerDirectionFor()).toThrow(DomainError);
    });
  });

  describe("transições", () => {
    it("PENDING vai para PROCESSED", () => {
      const tx = build();
      tx.markProcessed("ref-1", at);
      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.referenceTransactionId).toBe("ref-1");
      expect(tx.processedAt).toEqual(at);
    });

    it("PENDING vai para PENDING_REFERENCE e conta as tentativas", () => {
      const tx = reversal(WagerTransactionKind.Refund);
      const next = new Date("2026-01-01T00:00:10Z");
      tx.markPendingReference(next);
      tx.markPendingReference(next);
      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.referenceAttempts).toBe(2);
      expect(tx.nextAttemptAt).toEqual(next);
    });

    it("PENDING_REFERENCE vai para REJECTED com o código", () => {
      const tx = reversal(WagerTransactionKind.Refund);
      tx.markPendingReference(at);
      tx.reject(FailureCode.ReferenceNotFound);
      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.ReferenceNotFound);
      expect(tx.nextAttemptAt).toBeUndefined();
    });

    it("PENDING vai para FAILED", () => {
      const tx = build();
      tx.fail(FailureCode.PermanentError);
      expect(tx.status).toBe(WagerTransactionStatus.Failed);
    });

    it("estado terminal não transiciona mais", () => {
      const tx = processed();
      expect(tx.isTerminal()).toBe(true);
      expect(() => tx.markProcessed(undefined, at)).toThrow(InvalidTransactionStateError);
      expect(() => tx.markPendingReference(at)).toThrow(InvalidTransactionStateError);
      expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow(InvalidTransactionStateError);
      expect(() => tx.fail(FailureCode.PermanentError)).toThrow(InvalidTransactionStateError);
    });

    it("REJECTED também é terminal", () => {
      const tx = build();
      tx.reject(FailureCode.InsufficientFunds);
      expect(() => tx.markProcessed(undefined, at)).toThrow(InvalidTransactionStateError);
    });
  });

  describe("validação da referência", () => {
    it("aceita REFUND de uma BET processada", () => {
      expect(reversal(WagerTransactionKind.Refund).checkReference(processed())).toBeUndefined();
    });

    it("aceita ROLLBACK de WIN processada", () => {
      const win = processed({ kind: WagerTransactionKind.Win });
      expect(reversal(WagerTransactionKind.Rollback).checkReference(win)).toBeUndefined();
    });

    it("REFUND só referencia BET", () => {
      const win = processed({ kind: WagerTransactionKind.Win });
      expect(reversal(WagerTransactionKind.Refund).checkReference(win)).toBe(FailureCode.InvalidReferenceKind);
    });

    it("rejeita referência de outra rodada", () => {
      const other = processed({ roundId: "round-2" });
      expect(reversal(WagerTransactionKind.Refund).checkReference(other)).toBe(FailureCode.ReferenceMismatch);
    });

    it("rejeita referência de outro jogador", () => {
      const other = processed({ playerId: "player-2" });
      expect(reversal(WagerTransactionKind.Refund).checkReference(other)).toBe(FailureCode.ReferenceMismatch);
    });

    it("rejeita referência que não foi processada", () => {
      expect(reversal(WagerTransactionKind.Refund).checkReference(build())).toBe(FailureCode.ReferenceNotProcessed);
    });

    it("exige valor igual ao da referência", () => {
      const refund = reversal(WagerTransactionKind.Refund, { money: brl("10.00") });
      expect(refund.checkReference(processed())).toBe(FailureCode.ReferenceAmountMismatch);
    });
  });
});