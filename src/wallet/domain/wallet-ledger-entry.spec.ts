import { describe, it, expect } from "bun:test";
import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { LedgerDirection } from "./ledger-direction";
import { WalletLedgerEntry } from "./wallet-ledger-entry";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });

const base = {
  id: "entry-1",
  walletId: "wallet-1",
  transactionId: "tx-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("WalletLedgerEntry", () => {
  it("cria um débito balanceado", () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.DEBIT,
      money: brl("25.00"),
      balanceBefore: brl("100.00"),
      balanceAfter: brl("75.00"),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it("cria um crédito balanceado", () => {
    const entry = WalletLedgerEntry.create({
      ...base,
      direction: LedgerDirection.CREDIT,
      money: brl("25.00"),
      balanceBefore: brl("75.00"),
      balanceAfter: brl("100.00"),
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it("rejeita lançamento que não fecha a conta", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.DEBIT,
        money: brl("25.00"),
        balanceBefore: brl("100.00"),
        balanceAfter: brl("80.00"),
      }),
    ).toThrow(DomainError);
  });

  it("rejeita valor zero", () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...base,
        direction: LedgerDirection.CREDIT,
        money: brl("0.00"),
        balanceBefore: brl("100.00"),
        balanceAfter: brl("100.00"),
      }),
    ).toThrow(DomainError);
  });

  it("rehydrate não revalida o lançamento", () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...base,
      direction: LedgerDirection.DEBIT,
      money: brl("25.00"),
      balanceBefore: brl("100.00"),
      balanceAfter: brl("80.00"),
    });
    expect(entry.isBalanced()).toBe(false);
  });
});