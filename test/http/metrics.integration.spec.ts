import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { metricValue } from "../support/metrics";
import { createTestContext, TestContext } from "../support/test-context";

describe("GET /metrics (integration)", () => {
  let ctx: TestContext;
  let baseUrl: string;
  let wallet: WalletOutput;

  beforeAll(async () => {
    ctx = await createTestContext();
    baseUrl = await ctx.startHttp();
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

  async function scrape(): Promise<string> {
    const response = await fetch(`${baseUrl}/metrics`);
    expect(response.status).toBe(200);
    return response.text();
  }

  it("responde texto no formato Prometheus", async () => {
    const response = await fetch(`${baseUrl}/metrics`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("# TYPE wager_transactions_total counter");
    expect(text).toContain("# TYPE wager_processing_duration_seconds histogram");
  });

  it("conta transacoes por status, duplicatas e latencia", async () => {
    const processed = transactionInput(wallet);
    await ctx.processTransaction.execute(processed);
    await ctx.processTransaction.execute(processed);
    await ctx.processTransaction.execute(
      transactionInput(wallet, { money: { amount: "500.00", currency: "BRL" } }),
    );

    const text = await scrape();
    expect(metricValue(text, 'wager_transactions_total{status="PROCESSED"}')).toBe(1);
    expect(metricValue(text, 'wager_transactions_total{status="REJECTED"}')).toBe(1);
    expect(metricValue(text, "wager_duplicates_total")).toBe(1);
    expect(metricValue(text, "wager_processing_duration_seconds_count")).toBe(3);
  });

  it("transacao que cai em PENDING_REFERENCE e depois e resolvida conta os dois estados", async () => {
    const refund = transactionInput(wallet, {
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "bet-late",
    });
    await ctx.processTransaction.execute(refund);
    await ctx.processTransaction.execute(
      transactionInput(wallet, { externalTransactionId: "bet-late" }),
    );
    await ctx.pendingReferences.retryDue(new Date(Date.now() + 10_000));

    const text = await scrape();
    expect(metricValue(text, 'wager_transactions_total{status="PENDING_REFERENCE"}')).toBe(1);
    expect(metricValue(text, 'wager_transactions_total{status="PROCESSED"}')).toBe(2);
  });

  it("retry da referencia pendente que continua pendente conta em retries", async () => {
    await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "never",
      }),
    );
    await ctx.pendingReferences.retryDue(new Date(Date.now() + 10_000));

    const text = await scrape();
    expect(metricValue(text, 'wager_retries_total{source="pending_reference"}')).toBe(1);
  });

  it("mostra pendencia e lag do outbox e zera depois de publicar", async () => {
    await ctx.processTransaction.execute(transactionInput(wallet));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const before = await scrape();
    expect(metricValue(before, "wager_outbox_pending_events")).toBe(2);
    expect(metricValue(before, "wager_outbox_lag_seconds")).toBeGreaterThan(0);

    await ctx.outboxPublisher.publishBatch();

    const after = await scrape();
    expect(metricValue(after, "wager_outbox_pending_events")).toBe(0);
    expect(metricValue(after, "wager_outbox_lag_seconds")).toBe(0);
    expect(metricValue(after, "wager_outbox_published_total")).toBe(2);
  });

  it("falha do broker conta retry do outbox", async () => {
    await ctx.processTransaction.execute(transactionInput(wallet));
    ctx.broker.failing = true;

    await ctx.outboxPublisher.publishBatch();

    const text = await scrape();
    expect(metricValue(text, 'wager_retries_total{source="outbox"}')).toBe(1);
    expect(metricValue(text, "wager_outbox_pending_events")).toBe(2);
  });

  it("mensagem duplicada no consumidor conta como duplicata", async () => {
    const body = JSON.stringify({
      messageId: uuidv7(),
      type: "WagerTransactionRequested",
      occurredAt: new Date().toISOString(),
      data: {
        providerId: "provider-a",
        externalTransactionId: "metrics-msg-1",
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: "round-1",
        gameId: "game-1",
        kind: "BET",
        money: { amount: "25.00", currency: "BRL" },
      },
    });

    await ctx.consumer.consume(body);
    await ctx.consumer.consume(body);

    const text = await scrape();
    expect(metricValue(text, 'wager_transactions_total{status="PROCESSED"}')).toBe(1);
    expect(metricValue(text, "wager_duplicates_total")).toBe(1);
  });

  it("nao expoe valores nem identificadores nos rotulos", async () => {
    await ctx.processTransaction.execute(transactionInput(wallet));

    const text = await scrape();
    expect(text).not.toContain(wallet.id);
    expect(text).not.toContain("25.00");
  });
});
