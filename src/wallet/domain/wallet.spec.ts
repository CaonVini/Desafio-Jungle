import { describe, it, expect } from "bun:test";
import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { InsufficientFundsError } from "./insufficient-funds.error";
import { LedgerDirection } from "./ledger-direction";
import { Wallet } from "./wallet";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const usd = (amount: string) => Money.from({ amount, currency: "USD" });
const at = new Date("2026-01-01T00:00:00Z");

const openWallet = (balance = "100.00") =>
  Wallet.open({ id: "wallet-1", playerId: "player-1", initialBalance: brl(balance), now: at });

const movement = (money: Money, n = 1) => ({
  entryId: `entry-${n}`,
  transactionId: `tx-${n}`,
  money,
  at,
});

describe("Wallet", () => {
  it("abre com version 1 e a moeda do saldo inicial", () => {
    const wallet = openWallet();
    expect(wallet.version).toBe(1);
    expect(wallet.currency).toBe("BRL");
    expect(wallet.balance.toString()).toBe("100.00");
  });

  it("debita, sobe a version e devolve o lançamento", () => {
    const wallet = openWallet();
    const entry = wallet.debit(movement(brl("25.00")));
    expect(wallet.balance.toString()).toBe("75.00");
    expect(wallet.version).toBe(2);
    expect(entry.direction).toBe(LedgerDirection.DEBIT);
    expect(entry.balanceBefore.toString()).toBe("100.00");
    expect(entry.balanceAfter.toString()).toBe("75.00");
    expect(entry.isBalanced()).toBe(true);
  });

  it("credita", () => {
    const wallet = openWallet();
    const entry = wallet.credit(movement(brl("50.00")));
    expect(wallet.balance.toString()).toBe("150.00");
    expect(entry.direction).toBe(LedgerDirection.CREDIT);
  });

  it("rejeita saldo insuficiente sem alterar a wallet", () => {
    const wallet = openWallet();
    expect(() => wallet.debit(movement(brl("100.01")))).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe("100.00");
    expect(wallet.version).toBe(1);
  });

  it("cenário das duas apostas de 80 com saldo 100", () => {
    const wallet = openWallet();
    wallet.debit(movement(brl("80.00"), 1));
    expect(() => wallet.debit(movement(brl("80.00"), 2))).toThrow(InsufficientFundsError);
    expect(wallet.balance.toString()).toBe("20.00");
  });

  it("aceita debitar exatamente o saldo", () => {
    const wallet = openWallet();
    wallet.debit(movement(brl("100.00")));
    expect(wallet.balance.isZero()).toBe(true);
  });

  it("rejeita moeda diferente", () => {
    const wallet = openWallet();
    expect(() => wallet.debit(movement(usd("10.00")))).toThrow(DomainError);
    expect(() => wallet.credit(movement(usd("10.00")))).toThrow(DomainError);
  });

  it("rejeita movimentação de valor zero", () => {
    const wallet = openWallet();
    expect(() => wallet.credit(movement(brl("0.00")))).toThrow(DomainError);
  });

  it("rehydrate preserva o estado sem mexer na version", () => {
    const wallet = Wallet.rehydrate({
      id: "wallet-1",
      playerId: "player-1",
      currency: "BRL",
      balance: brl("20.00"),
      version: 7,
      createdAt: at,
      updatedAt: at,
    });
    expect(wallet.version).toBe(7);
    expect(wallet.balance.toString()).toBe("20.00");
  });
});