import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { FailureCode, WagerTransactionStatus } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

const TIMEOUT_MS = 30_000;

describe("ProcessWagerTransaction (concurrency)", () => {
  let ctx: TestContext;
  let wallet: WalletOutput;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function openWallet(amount: string): Promise<WalletOutput> {
    return ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount, currency: "BRL" },
    });
  }

  beforeEach(async () => {
    await ctx.reset();
    wallet = await openWallet("1000.00");
  });

  it(
    "50 apostas identicas em paralelo debitam uma unica vez",
    async () => {
      const input = transactionInput(wallet);

      const results = await Promise.all(
        Array.from({ length: 50 }, () => ctx.processTransaction.execute(input)),
      );

      expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
      expect(new Set(results.map((result) => result.transaction.id)).size).toBe(1);

      const current = await ctx.getWallet.execute(wallet.id);
      expect(current.balance.amount).toBe("975.00");
      expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
      await expectInvariant(ctx, wallet.id);
    },
    TIMEOUT_MS,
  );

  it(
    "duas apostas de 80 com saldo 100: so uma passa",
    async () => {
      const small = await openWallet("100.00");

      const results = await Promise.all([
        ctx.processTransaction.execute(
          transactionInput(small, { money: { amount: "80.00", currency: "BRL" } }),
        ),
        ctx.processTransaction.execute(
          transactionInput(small, { money: { amount: "80.00", currency: "BRL" } }),
        ),
      ]);

      const processed = results.filter(
        (result) => result.transaction.status === WagerTransactionStatus.Processed,
      );
      const rejected = results.filter(
        (result) => result.transaction.status === WagerTransactionStatus.Rejected,
      );
      expect(processed).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].transaction.failureCode).toBe(FailureCode.InsufficientFunds);

      const current = await ctx.getWallet.execute(small.id);
      expect(current.balance.amount).toBe("20.00");
      await expectInvariant(ctx, small.id);
    },
    TIMEOUT_MS,
  );

  it(
    "50 apostas diferentes na mesma wallet mantem saldo, versao e ledger coerentes",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          ctx.processTransaction.execute(
            transactionInput(wallet, { money: { amount: "10.00", currency: "BRL" } }),
          ),
        ),
      );

      expect(
        results.every((result) => result.transaction.status === WagerTransactionStatus.Processed),
      ).toBe(true);

      const current = await ctx.getWallet.execute(wallet.id);
      expect(current.balance.amount).toBe("500.00");
      expect(current.version).toBe(51);
      expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(50);
      await expectInvariant(ctx, wallet.id);
    },
    TIMEOUT_MS,
  );

  it(
    "3 instancias independentes processando a mesma aposta",
    async () => {
      const extras = await Promise.all([createTestContext(), createTestContext()]);
      const instances = [ctx, ...extras];

      try {
        const input = transactionInput(wallet);

        const results = await Promise.all(
          Array.from({ length: 60 }, (_, index) =>
            instances[index % instances.length].processTransaction.execute(input),
          ),
        );

        expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
        expect(new Set(results.map((result) => result.transaction.id)).size).toBe(1);

        const current = await ctx.getWallet.execute(wallet.id);
        expect(current.balance.amount).toBe("975.00");
        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
        await expectInvariant(ctx, wallet.id);
      } finally {
        await Promise.all(extras.map((extra) => extra.close()));
      }
    },
    TIMEOUT_MS,
  );
});