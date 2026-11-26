import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DatabaseBusyError } from "../../src/shared/domain/database-busy.error";
import { TransactionManager } from "../../src/shared/domain/transaction-manager";
import { asManager } from "../../src/shared/infra/database/typeorm-helpers";
import { createTestContext, TestContext } from "../support/test-context";

describe("timeouts do banco", () => {
  let ctx: TestContext;
  let transactions: TransactionManager;

  beforeAll(async () => {
    ctx = await createTestContext();
    transactions = ctx.moduleRef.get(TransactionManager, { strict: false });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("toda conexao do pool abre com lock_timeout, statement_timeout e idle_in_transaction", async () => {
    const [row] = await ctx.dataSource.query(
      `SELECT current_setting('lock_timeout') AS lock,
              current_setting('statement_timeout') AS statement,
              current_setting('idle_in_transaction_session_timeout') AS idle`,
    );
    expect(row).toEqual({ lock: "5s", statement: "15s", idle: "30s" });
  });

  it("statement_timeout vira DatabaseBusyError", async () => {
    const attempt = transactions.run(async (tx) => {
      await asManager(tx).query("SET LOCAL statement_timeout = '100ms'");
      await asManager(tx).query("SELECT pg_sleep(2)");
    });
    await expect(attempt).rejects.toBeInstanceOf(DatabaseBusyError);
  });

  it("lock_timeout vira DatabaseBusyError e nao deixa a conexao presa", async () => {
    await ctx.reset();
    const wallet = await ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount: "10.00", currency: "BRL" },
    });
    const holder = ctx.dataSource.createQueryRunner();
    await holder.connect();
    await holder.startTransaction();
    await holder.query("SELECT id FROM wallets WHERE id = $1 FOR UPDATE", [wallet.id]);

    try {
      const startedAt = Date.now();
      const attempt = transactions.run(async (tx) => {
        await asManager(tx).query("SET LOCAL lock_timeout = '150ms'");
        await asManager(tx).query("SELECT id FROM wallets WHERE id = $1 FOR UPDATE", [wallet.id]);
      });
      await expect(attempt).rejects.toBeInstanceOf(DatabaseBusyError);
      expect(Date.now() - startedAt).toBeLessThan(2000);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }

    const [row] = await ctx.dataSource.query("SELECT 1 AS ok");
    expect(row.ok).toBe(1);
  });
});
