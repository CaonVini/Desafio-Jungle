import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { transactionInput } from "../../test/support/fixtures";
import { createTestContext, TestContext } from "./../../test/support/test-context";

function message(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: uuidv7(),
    type: "wager.transaction.processed",
    payload: { amount: "25.00" },
    ...overrides,
  });
}

describe("Inbox consumer (integration)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  it("processa a mensagem e registra no inbox", async () => {
    const body = message();

    const result = await ctx.inboxConsumer.consume(body);

    expect(result).toBe("PROCESSED");
    expect(ctx.eventHandler.handled).toHaveLength(1);
    expect(await ctx.inboxCount()).toBe(1);
  });

  it("mensagem duplicada e ignorada", async () => {
    const body = message();

    await ctx.inboxConsumer.consume(body);
    const second = await ctx.inboxConsumer.consume(body);

    expect(second).toBe("DUPLICATE");
    expect(ctx.eventHandler.handled).toHaveLength(1);
    expect(await ctx.inboxCount()).toBe(1);
  });

  it("falha no handler nao grava no inbox, e a nova tentativa funciona", async () => {
    const body = message();
    ctx.eventHandler.failing = true;

    await expect(ctx.inboxConsumer.consume(body)).rejects.toThrow("handler falhou");
    expect(await ctx.inboxCount()).toBe(0);

    ctx.eventHandler.failing = false;
    expect(await ctx.inboxConsumer.consume(body)).toBe("PROCESSED");
    expect(ctx.eventHandler.handled).toHaveLength(1);
  });

  it("mensagem invalida e rejeitada sem tocar no banco", async () => {
    await expect(ctx.inboxConsumer.consume("isso nao e json")).rejects.toThrow();
    await expect(ctx.inboxConsumer.consume(message({ id: "123" }))).rejects.toThrow(
      "Invalid message",
    );
    await expect(ctx.inboxConsumer.consume(message({ type: undefined }))).rejects.toThrow(
      "Invalid message",
    );

    expect(await ctx.inboxCount()).toBe(0);
    expect(ctx.eventHandler.handled).toHaveLength(0);
  });

  it("a mesma mensagem entregue 20 vezes em paralelo e processada uma unica vez", async () => {
    const body = message();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => ctx.inboxConsumer.consume(body)),
    );

    expect(results.filter((r) => r === "PROCESSED")).toHaveLength(1);
    expect(results.filter((r) => r === "DUPLICATE")).toHaveLength(19);
    expect(ctx.eventHandler.handled).toHaveLength(1);
    expect(await ctx.inboxCount()).toBe(1);
  });

  it("consome o que o outbox publicou (o id do evento e a chave do inbox)", async () => {
    const wallet = await ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
    await ctx.processTransaction.execute(transactionInput(wallet));
    await ctx.outboxPublisher.publishBatch();

    const [sent] = ctx.broker.sent;
    expect(await ctx.inboxConsumer.consume(JSON.stringify(sent))).toBe("PROCESSED");
    expect(await ctx.inboxConsumer.consume(JSON.stringify(sent))).toBe("DUPLICATE");
    expect(ctx.eventHandler.handled[0]).toMatchObject({
      id: sent.id,
      type: "wager.transaction.processed",
    });
  });
});