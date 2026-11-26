import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { backoffDelayMs } from "../../src/outbox/application/outbox-publisher.service";
import { OutboxRepository } from "../../src/outbox/domain/outbox.repository";
import { TransactionManager } from "../../src/shared/domain/transaction-manager";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, TestContext } from "../support/test-context";

describe("Outbox publisher (integration)", () => {
  let ctx: TestContext;
  let wallet: WalletOutput;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    wallet = await ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount: "1000.00", currency: "BRL" },
    });
  });

  async function createEvents(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await ctx.processTransaction.execute(
        transactionInput(wallet, { kind: WagerTransactionKind.Loss }),
      );
    }
  }

  it("publica eventos pendentes e marca como PUBLISHED", async () => {
    await createEvents(3);

    const result = await ctx.outboxPublisher.publishBatch();

    expect(result).toEqual({ claimed: 3, published: 3, failed: 0 });
    expect(ctx.broker.sent).toHaveLength(3);
    const events = await ctx.outboxEvents();
    expect(events.every((e) => e.status === "PUBLISHED" && e.attempts === 1)).toBe(true);
  });

  it("a mensagem enviada carrega o id do evento (chave de deduplicacao do consumidor)", async () => {
    await createEvents(1);
    await ctx.outboxPublisher.publishBatch();

    const [row] = await ctx.dataSource.query("SELECT id FROM outbox_events");
    expect(ctx.broker.sent[0].id).toBe(row.id);
    expect(ctx.broker.sent[0].type).toBe("WagerTransactionProcessed");
  });

  it("nao republica o que ja foi publicado", async () => {
    await createEvents(2);
    await ctx.outboxPublisher.publishBatch();
    const second = await ctx.outboxPublisher.publishBatch();

    expect(second.claimed).toBe(0);
    expect(ctx.broker.sent).toHaveLength(2);
  });

  it("falha no broker mantem PENDING, conta tentativa e agenda nova tentativa", async () => {
    await createEvents(1);
    ctx.broker.failing = true;
    const now = new Date();

    const result = await ctx.outboxPublisher.publishBatch(now);

    expect(result).toEqual({ claimed: 1, published: 0, failed: 1 });
    const [row] = await ctx.dataSource.query(
      "SELECT status, attempts, last_error, next_attempt_at FROM outbox_events",
    );
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("broker indisponivel");
    expect(new Date(row.next_attempt_at).getTime()).toBe(now.getTime() + backoffDelayMs(1));
  });

  it("respeita o backoff e depois recupera quando o broker volta", async () => {
    await createEvents(1);
    ctx.broker.failing = true;
    const now = new Date();
    await ctx.outboxPublisher.publishBatch(now);

    ctx.broker.failing = false;
    const tooEarly = await ctx.outboxPublisher.publishBatch(new Date(now.getTime() + 500));
    expect(tooEarly.claimed).toBe(0);

    const later = await ctx.outboxPublisher.publishBatch(
      new Date(now.getTime() + backoffDelayMs(1) + 1),
    );
    expect(later).toEqual({ claimed: 1, published: 1, failed: 0 });
    const [row] = await ctx.dataSource.query(
      "SELECT status, attempts, last_error FROM outbox_events",
    );
    expect(row).toMatchObject({ status: "PUBLISHED", attempts: 2, last_error: null });
  });

  it("interrompe o lote na primeira falha (nao espera timeout de cada evento)", async () => {
    await createEvents(3);
    ctx.broker.failing = true;

    const result = await ctx.outboxPublisher.publishBatch();

    expect(result).toEqual({ claimed: 3, published: 0, failed: 1 });
    const rows = await ctx.dataSource.query(
      "SELECT attempts FROM outbox_events ORDER BY attempts DESC",
    );
    expect(rows.map((r: { attempts: number }) => r.attempts)).toEqual([1, 0, 0]);
  });

  it("respeita o tamanho do lote", async () => {
    await createEvents(5);
    const result = await ctx.outboxPublisher.publishBatch(new Date(), 2);

    expect(result.claimed).toBe(2);
    expect(ctx.broker.sent).toHaveLength(2);
  });

  it("claimPending pula linhas travadas por outra transacao (SKIP LOCKED)", async () => {
    await createEvents(6);
    const transactions = ctx.moduleRef.get(TransactionManager, { strict: false });
    const outbox = ctx.moduleRef.get(OutboxRepository, { strict: false });

    await transactions.run(async (txA) => {
      const a = await outbox.claimPending(txA, new Date(), 3);
      const b = await transactions.run((txB) => outbox.claimPending(txB, new Date(), 3));

      expect(a).toHaveLength(3);
      expect(b).toHaveLength(3);
      const idsA = new Set(a.map((e) => e.id));
      expect(b.some((e) => idsA.has(e.id))).toBe(false);
    });
  });

  it("varios publicadores em paralelo publicam cada evento uma unica vez", async () => {
    await createEvents(20);

    await Promise.all(
      Array.from({ length: 5 }, () => ctx.outboxPublisher.publishBatch(new Date(), 4)),
    );

    const ids = ctx.broker.sent.map((m) => m.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });
});
