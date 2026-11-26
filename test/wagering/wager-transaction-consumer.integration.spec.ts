import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { ProcessWagerTransactionUseCase } from "../../src/wagering/application/process-wager-transaction.use-case";
import { PermanentMessageError } from "../../src/wagering/messaging/wager-transaction-consumer";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

describe("WagerTransactionConsumer (integration)", () => {
  let ctx: TestContext;
  let wallet: WalletOutput;
  let sequence = 0;

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

  function requested(
    data: Record<string, unknown> = {},
    envelope: Record<string, unknown> = {},
  ): string {
    sequence += 1;
    return JSON.stringify({
      messageId: uuidv7(),
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-a",
        externalTransactionId: `msg-tx-${sequence}`,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
        ...data,
      },
      ...envelope,
    });
  }

  async function balance(): Promise<string> {
    return (await ctx.getWallet.execute(wallet.id)).balance.amount;
  }

  it("processa o pedido: saldo, ledger, inbox e evento na mesma transacao", async () => {
    const outcome = await ctx.consumer.consume(requested());

    expect(outcome).toBe("PROCESSED");
    expect(await balance()).toBe("75.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    expect(await ctx.inboxCount()).toBe(1);
    expect(await ctx.outboxEvents()).toHaveLength(1);
    await expectInvariant(ctx, wallet.id);
  });

  it("redelivery da mesma mensagem (crash antes do ack) nao debita de novo", async () => {
    const body = requested();

    await ctx.consumer.consume(body);
    const redelivered = await ctx.consumer.consume(body);

    expect(redelivered).toBe("DUPLICATE");
    expect(await balance()).toBe("75.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    expect(await ctx.inboxCount()).toBe(1);
  });

  it("a mesma mensagem entregue 20 vezes em paralelo e processada uma unica vez", async () => {
    const body = requested();

    const results = await Promise.all(Array.from({ length: 20 }, () => ctx.consumer.consume(body)));

    expect(results.filter((r) => r === "PROCESSED")).toHaveLength(1);
    expect(results.filter((r) => r === "DUPLICATE")).toHaveLength(19);
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    await expectInvariant(ctx, wallet.id);
  });

  it("mensagens diferentes com a mesma transacao nao debitam duas vezes (idempotencia)", async () => {
    const data = { externalTransactionId: "same-tx" };

    expect(await ctx.consumer.consume(requested(data))).toBe("PROCESSED");
    expect(await ctx.consumer.consume(requested(data))).toBe("PROCESSED");

    expect(await balance()).toBe("75.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    expect(await ctx.inboxCount()).toBe(2);
  });

  it("saldo insuficiente e rejeicao de negocio persistida: a mensagem e confirmada", async () => {
    const outcome = await ctx.consumer.consume(
      requested({ money: { amount: "500.00", currency: "BRL" } }),
    );

    expect(outcome).toBe("PROCESSED");
    expect(await balance()).toBe("100.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(0);
    const events = await ctx.outboxEvents();
    expect(events[0].event_type).toBe("wager.transaction.rejected");
  });

  it("erro de negocio (wallet inexistente, conflito) e terminal: confirma sem gravar o inbox", async () => {
    const unknownWallet = await ctx.consumer.consume(requested({ walletId: uuidv7() }));
    expect(unknownWallet).toBe("BUSINESS_ERROR");
    expect(await ctx.inboxCount()).toBe(0);

    await ctx.consumer.consume(requested({ externalTransactionId: "dup" }));
    const conflict = await ctx.consumer.consume(
      requested({ externalTransactionId: "dup", money: { amount: "30.00", currency: "BRL" } }),
    );
    expect(conflict).toBe("BUSINESS_ERROR");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
  });

  it("mensagem invalida e erro permanente (vai para a DLQ) e nao toca no banco", async () => {
    const invalid = [
      "isso nao e json",
      requested({}, { type: "OutraCoisa" }),
      requested({}, { messageId: undefined }),
      requested({}, { occurredAt: "ontem" }),
      requested({}, { data: undefined }),
      requested({ money: { amount: "1e5", currency: "BRL" } }),
      requested({ kind: "OPENING" }),
      requested({ walletId: "nao-e-uuid" }),
    ];

    for (const body of invalid) {
      await expect(ctx.consumer.consume(body)).rejects.toBeInstanceOf(PermanentMessageError);
    }

    expect(await ctx.inboxCount()).toBe(0);
    expect(await balance()).toBe("100.00");
  });

  it("falha transitoria desfaz tudo (inbox incluido) e a nova tentativa funciona", async () => {
    const body = requested();
    const useCase = ctx.moduleRef.get(ProcessWagerTransactionUseCase, { strict: false });
    const spy = spyOn(useCase, "executeWithin").mockRejectedValueOnce(new Error("db down"));

    await expect(ctx.consumer.consume(body)).rejects.toThrow("db down");
    expect(await ctx.inboxCount()).toBe(0);
    expect(await ctx.outboxEvents()).toHaveLength(0);
    expect(await balance()).toBe("100.00");

    expect(await ctx.consumer.consume(body)).toBe("PROCESSED");
    expect(await balance()).toBe("75.00");
    spy.mockRestore();
  });
});
