import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import {
  AppProcess,
  freePort,
  postWager,
  startApp,
  startMany,
  stopAll,
  wagerBody,
} from "../support/process-harness";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

const TIMEOUT_MS = 90_000;

describe("varias instancias (processos reais)", () => {
  let ctx: TestContext;
  let apps: AppProcess[];

  beforeAll(async () => {
    ctx = await createTestContext();
    await ctx.reset();
    apps = await startMany(3, { workers: false });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await stopAll(apps ?? []);
    await ctx?.close();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  function openWallet(amount: string): Promise<WalletOutput> {
    return ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount, currency: "BRL" },
    });
  }

  const pick = (index: number): AppProcess => apps[index % apps.length] as AppProcess;

  it(
    "tres processos de fato distintos",
    () => {
      expect(new Set(apps.map((app) => app.pid)).size).toBe(3);
      expect(new Set(apps.map((app) => app.port)).size).toBe(3);
    },
    TIMEOUT_MS,
  );

  it(
    "a mesma aposta 50 vezes em paralelo nos 3 processos debita uma vez",
    async () => {
      const wallet = await openWallet("1000.00");
      const body = wagerBody(wallet, "same-bet", "25.00");

      const results = await Promise.all(
        Array.from({ length: 50 }, (_, index) => postWager(pick(index), body)),
      );

      expect(results.every((result) => result.status === 200)).toBe(true);
      expect(results.filter((result) => result.body.idempotentReplay === false)).toHaveLength(1);
      expect(new Set(results.map((result) => result.body.transactionId)).size).toBe(1);
      expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
      expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("975.00");
      await expectInvariant(ctx, wallet.id);
    },
    TIMEOUT_MS,
  );

  it(
    "saldo 100.00 e duas apostas de 80.00 em processos diferentes (10 carteiras)",
    async () => {
      const wallets = await Promise.all(Array.from({ length: 10 }, () => openWallet("100.00")));

      const results = await Promise.all(
        wallets.flatMap((wallet, index) => [
          postWager(pick(index), wagerBody(wallet, `a-${index}`, "80.00")),
          postWager(pick(index + 1), wagerBody(wallet, `b-${index}`, "80.00")),
        ]),
      );

      expect(results.filter((result) => result.body.status === "PROCESSED")).toHaveLength(10);
      const rejected = results.filter((result) => result.body.status === "REJECTED");
      expect(rejected).toHaveLength(10);
      expect(rejected.every((result) => result.body.failureCode === "INSUFFICIENT_FUNDS")).toBe(
        true,
      );
      for (const wallet of wallets) {
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("20.00");
        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
        await expectInvariant(ctx, wallet.id);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "carteiras distintas progridem em paralelo, com saldo exato e sem lost update",
    async () => {
      const wallets = await Promise.all(Array.from({ length: 12 }, () => openWallet("500.00")));

      const results = await Promise.all(
        wallets.flatMap((wallet, walletIndex) =>
          Array.from({ length: 10 }, (_, betIndex) =>
            postWager(
              pick(walletIndex + betIndex),
              wagerBody(wallet, `w${walletIndex}-b${betIndex}`, "7.50"),
            ),
          ),
        ),
      );

      expect(results.every((result) => result.body.status === "PROCESSED")).toBe(true);
      for (const wallet of wallets) {
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("425.00");
        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(10);
        await expectInvariant(ctx, wallet.id);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "carteira quente: 150 apostas de 1.00 com saldo 100.00 aceitam exatamente 100",
    async () => {
      const wallet = await openWallet("100.00");

      const results = await Promise.all(
        Array.from({ length: 150 }, (_, index) =>
          postWager(pick(index), wagerBody(wallet, `hot-${index}`, "1.00")),
        ),
      );

      expect(results.filter((result) => result.body.status === "PROCESSED")).toHaveLength(100);
      expect(results.filter((result) => result.body.status === "REJECTED")).toHaveLength(50);
      expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("0.00");
      expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(100);
      await expectInvariant(ctx, wallet.id);
    },
    TIMEOUT_MS,
  );

  it(
    "carteira presa vira 503 com Retry-After, e o retry com a mesma chave debita uma vez",
    async () => {
      const wallet = await openWallet("100.00");
      const impatient = await startApp({
        port: freePort(),
        workers: false,
        env: { DB_LOCK_TIMEOUT_MS: "300" },
      });
      const holder = ctx.dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query("SELECT id FROM wallets WHERE id = $1 FOR UPDATE", [wallet.id]);

      try {
        const body = wagerBody(wallet, "stuck-bet", "10.00");
        const startedAt = Date.now();
        const response = await fetch(`${impatient.url}/wagering/transactions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": "stuck-bet-key",
          },
          body: JSON.stringify(body),
        });

        expect(response.status).toBe(503);
        expect(response.headers.get("retry-after")).toBe("1");
        expect(((await response.json()) as { code: string }).code).toBe("DATABASE_BUSY");
        expect(Date.now() - startedAt).toBeLessThan(5000);
        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(0);
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }

      try {
        const retry = await postWager(
          impatient,
          wagerBody(wallet, "stuck-bet", "10.00"),
          "stuck-bet-key",
        );
        expect(retry.status).toBe(200);
        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("90.00");
        await expectInvariant(ctx, wallet.id);
      } finally {
        await impatient.stop();
      }
    },
    TIMEOUT_MS,
  );

  it.skipIf(process.platform === "win32")(
    "SIGTERM encerra o processo sozinho, sem precisar de SIGKILL",
    async () => {
      const app = await startApp({ port: freePort(), workers: false });
      const code = await app.stop();
      expect([0, 143]).toContain(code);
      expect(app.isAlive()).toBe(false);
    },
    TIMEOUT_MS,
  );
});
