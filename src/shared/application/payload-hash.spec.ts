import { describe, it, expect } from "bun:test";
import { canonicalJson, hashPayload } from "./payload-hash";

describe("hashPayload", () => {
  it("ignora a ordem das chaves, inclusive aninhadas", () => {
    const a = { kind: "BET", money: { amount: "25.00", currency: "BRL" } };
    const b = { money: { currency: "BRL", amount: "25.00" }, kind: "BET" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashPayload(a)).toBe(hashPayload(b));
  });

  it("muda quando algum valor muda", () => {
    expect(hashPayload({ amount: "25.00" })).not.toBe(hashPayload({ amount: "25.01" }));
  });

  it("gera SHA-256 em hexadecimal", () => {
    expect(hashPayload({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});