import { describe, it, expect } from "bun:test";
import { Money } from "./money";
import { DomainError } from "./domain-error";

const brl = (amount: string) => Money.from({ amount, currency: "BRL" });
const usd = (amount: string) => Money.from({ amount, currency: "USD" });

describe("Money", () => {
  it("normaliza para 2 casas", () => {
    expect(brl("25").toString()).toBe("25.00");
    expect(brl("25.5").toString()).toBe("25.50");
  });

  it("rejeita entradas inválidas", () => {
    for (const bad of ["abc", "1e5", "", "-5", "1.234", "NaN", "Infinity", " 1.00"]) {
      expect(() => brl(bad)).toThrow(DomainError);
    }
  });

  it("rejeita moeda inválida", () => {
    expect(() => Money.from({ amount: "1.00", currency: "br" })).toThrow(DomainError);
  });

  it("não tem erro de ponto flutuante", () => {
    expect(brl("0.10").add(brl("0.20")).toString()).toBe("0.30");
  });

  it("subtrai e pode ficar negativo internamente", () => {
    const result = brl("0.00").subtract(brl("5.00"));
    expect(result.toString()).toBe("-5.00");
    expect(result.isNegative()).toBe(true);
  });

  it("negate inverte o sinal", () => {
    expect(brl("10.00").negate().toString()).toBe("-10.00");
  });

  it("é imutável", () => {
    const a = brl("100.00");
    a.subtract(brl("80.00"));
    expect(a.toString()).toBe("100.00");
  });

  it("lança erro com moedas diferentes", () => {
    expect(() => brl("1.00").add(usd("1.00"))).toThrow(DomainError);
    expect(() => brl("1.00").subtract(usd("1.00"))).toThrow(DomainError);
    expect(() => brl("1.00").isLessThan(usd("2.00"))).toThrow(DomainError);
  });

  it("compara valores", () => {
    expect(brl("1.00").isLessThan(brl("2.00"))).toBe(true);
    expect(brl("2.00").isLessThan(brl("1.00"))).toBe(false);
    expect(brl("1.00").equals(brl("1.0"))).toBe(true);
    expect(brl("1.00").equals(usd("1.00"))).toBe(false);
  });

  it("zero e sinais", () => {
    expect(Money.zero("BRL").isZero()).toBe(true);
    expect(brl("1.00").isPositive()).toBe(true);
    expect(brl("0.00").isPositive()).toBe(false);
  });

  it("serializa como string decimal", () => {
    expect(JSON.stringify(brl("25"))).toBe('{"amount":"25.00","currency":"BRL"}');
  });
});