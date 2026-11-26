import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, TestContext } from "../support/test-context";

describe("Outbox (integration)", () => {
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
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
  });

  async function eventTypes(): Promise<string[]> {
    return (await ctx.outboxEvents()).map((event) => event.event_type).sort();
  }

  it("aposta processada grava os eventos Processed e BalanceChanged na mesma transacao", async () => {
    const result = await ctx.processTransaction.execute(transactionInput(wallet));

    expect(await eventTypes()).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
    const events = await ctx.outboxEvents();
    expect(events.every((event) => event.status === "PENDING" && event.attempts === 0)).toBe(true);
    expect(events.every((event) => event.transaction_id === result.transaction.id)).toBe(true);

    const processed = events.find((event) => event.event_type === "WagerTransactionProcessed");
    expect(processed?.payload).toMatchObject({
      eventType: "WagerTransactionProcessed",
      version: 1,
      aggregateId: result.transaction.id,
      data: {
        id: result.transaction.id,
        status: "PROCESSED",
        amount: { amount: "25.00", currency: "BRL" },
      },
    });
  });

  it("BalanceChanged traz saldo antes e depois, direcao, versao da carteira e causa", async () => {
    const result = await ctx.processTransaction.execute(transactionInput(wallet));
    const current = await ctx.getWallet.execute(wallet.id);

    const events = await ctx.outboxEvents();
    const changed = events.find((event) => event.event_type === "WalletBalanceChanged");
    expect(changed?.payload).toMatchObject({
      eventType: "WalletBalanceChanged",
      version: 1,
      aggregateId: wallet.id,
      causationId: result.transaction.id,
      data: {
        walletId: wallet.id,
        transactionId: result.transaction.id,
        direction: "DEBIT",
        money: { amount: "25.00", currency: "BRL" },
        balanceBefore: { amount: "100.00", currency: "BRL" },
        balanceAfter: { amount: "75.00", currency: "BRL" },
        walletVersion: current.version,
      },
    });
  });

  it("o envelope tem id, correlationId e data ISO, e o id do evento e o da linha do outbox", async () => {
    await ctx.processTransaction.execute(transactionInput(wallet));

    const rows = await ctx.dataSource.query("SELECT id, payload FROM outbox_events");
    for (const row of rows) {
      expect(row.payload.eventId).toBe(row.id);
      expect(typeof row.payload.correlationId).toBe("string");
      expect(row.payload.correlationId.length).toBeGreaterThan(0);
      expect(new Date(row.payload.occurredAt).toISOString()).toBe(row.payload.occurredAt);
    }
  });

  it("rejeicao de negocio grava so o evento Rejected", async () => {
    const result = await ctx.processTransaction.execute(
      transactionInput(wallet, { money: { amount: "500.00", currency: "BRL" } }),
    );

    expect(await eventTypes()).toEqual(["WagerTransactionRejected"]);
    const [event] = await ctx.outboxEvents();
    expect(event?.payload).toMatchObject({
      eventType: "WagerTransactionRejected",
      aggregateId: result.transaction.id,
      data: { id: result.transaction.id, status: "REJECTED", failureCode: "INSUFFICIENT_FUNDS" },
    });
  });

  it("LOSS grava Processed e nenhum BalanceChanged, pois o saldo nao muda", async () => {
    await ctx.processTransaction.execute(
      transactionInput(wallet, { kind: WagerTransactionKind.Loss }),
    );

    expect(await eventTypes()).toEqual(["WagerTransactionProcessed"]);
  });

  it("replay nao duplica o evento", async () => {
    const input = transactionInput(wallet);
    await ctx.processTransaction.execute(input);
    const replay = await ctx.processTransaction.execute(input);

    expect(replay.idempotentReplay).toBe(true);
    expect(await ctx.outboxEvents()).toHaveLength(2);
  });

  it("conflito de idempotencia nao grava evento novo", async () => {
    const input = transactionInput(wallet);
    await ctx.processTransaction.execute(input);

    await expect(
      ctx.processTransaction.execute({ ...input, money: { amount: "30.00", currency: "BRL" } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    expect(await ctx.outboxEvents()).toHaveLength(2);
  });

  it("referencia pendente grava WagerTransactionPendingReference", async () => {
    const result = await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Win,
        referenceExternalTransactionId: "does-not-exist",
      }),
    );

    expect(result.transaction.status).toBe("PENDING_REFERENCE");
    expect(await eventTypes()).toEqual(["WagerTransactionPendingReference"]);
    const [event] = await ctx.outboxEvents();
    expect(event?.payload).toMatchObject({
      eventType: "WagerTransactionPendingReference",
      aggregateId: result.transaction.id,
      data: { status: "PENDING_REFERENCE", referenceExternalTransactionId: "does-not-exist" },
    });
  });

  it("20 requisicoes identicas em paralelo geram um unico par de eventos", async () => {
    const input = transactionInput(wallet);
    await Promise.all(Array.from({ length: 20 }, () => ctx.processTransaction.execute(input)));

    expect(await eventTypes()).toEqual(["WagerTransactionProcessed", "WalletBalanceChanged"]);
  });
});
