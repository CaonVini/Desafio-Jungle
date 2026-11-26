import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import {
  MAX_REFERENCE_ATTEMPTS,
  referenceRetryDelayMs,
} from "../../src/wagering/domain/reference-retry-policy";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

interface TransactionRow {
  id: string;
  status: string;
  failure_code: string | null;
  reference_attempts: number;
  next_attempt_at: Date | null;
  reference_transaction_id: string | null;
}

const inMs = (ms: number): Date => new Date(Date.now() + ms);

describe("PENDING_REFERENCE (integration)", () => {
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

  function reversal(kind: WagerTransactionKind, externalId: string, referenceId: string) {
    return transactionInput(wallet, {
      kind,
      externalTransactionId: externalId,
      referenceExternalTransactionId: referenceId,
    });
  }

  function bet(externalId: string, amount = "25.00") {
    return transactionInput(wallet, {
      externalTransactionId: externalId,
      money: { amount, currency: "BRL" },
    });
  }

  async function row(externalId: string): Promise<TransactionRow> {
    const rows = await ctx.dataSource.query(
      `SELECT id, status, failure_code, reference_attempts, next_attempt_at, reference_transaction_id
         FROM wager_transactions
        WHERE external_transaction_id = $1`,
      [externalId],
    );
    return rows[0];
  }

  async function balance(): Promise<string> {
    return (await ctx.getWallet.execute(wallet.id)).balance.amount;
  }

  it("REFUND que chega antes da aposta fica pendente e o worker conclui quando a aposta chega", async () => {
    const refund = await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Refund, "refund-1", "bet-1"),
    );
    expect(refund.transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(await balance()).toBe("1000.00");

    await ctx.processTransaction.execute(bet("bet-1"));
    expect(await balance()).toBe("975.00");

    const batch = await ctx.pendingReferences.retryDue(inMs(10_000));

    expect(batch).toMatchObject({ checked: 1, processed: 1, failed: 0 });
    expect(await balance()).toBe("1000.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    expect(await ctx.ledgerCount(wallet.id, "CREDIT")).toBe(2);

    const refundRow = await row("refund-1");
    const betRow = await row("bet-1");
    expect(refundRow.status).toBe(WagerTransactionStatus.Processed);
    expect(refundRow.reference_transaction_id).toBe(betRow.id);
    expect(refundRow.next_attempt_at).toBeNull();

    const events = await ctx.outboxEvents();
    expect(events.map((event) => event.event_type).sort()).toEqual([
      "WagerTransactionPendingReference",
      "WagerTransactionProcessed",
      "WagerTransactionProcessed",
      "WalletBalanceChanged",
      "WalletBalanceChanged",
    ]);
    await expectInvariant(ctx, wallet.id);
  });

  it("nao tenta antes do nextAttemptAt", async () => {
    await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Refund, "refund-2", "bet-2"),
    );
    await ctx.processTransaction.execute(bet("bet-2"));

    const batch = await ctx.pendingReferences.retryDue(new Date());

    expect(batch.checked).toBe(0);
    expect((await row("refund-2")).status).toBe(WagerTransactionStatus.PendingReference);
    expect(await balance()).toBe("975.00");
  });

  it("referencia ainda ausente: reagenda com espera crescente", async () => {
    await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Refund, "refund-3", "bet-3"),
    );
    expect((await row("refund-3")).reference_attempts).toBe(1);

    const firstRetryAt = inMs(60_000);
    const first = await ctx.pendingReferences.retryDue(firstRetryAt);
    expect(first.stillPending).toBe(1);
    let current = await row("refund-3");
    expect(current.reference_attempts).toBe(2);
    expect(current.next_attempt_at?.getTime()).toBe(
      firstRetryAt.getTime() + referenceRetryDelayMs(2),
    );

    const secondRetryAt = inMs(120_000);
    await ctx.pendingReferences.retryDue(secondRetryAt);
    current = await row("refund-3");
    expect(current.reference_attempts).toBe(3);
    expect(current.next_attempt_at?.getTime()).toBe(
      secondRetryAt.getTime() + referenceRetryDelayMs(3),
    );
    expect(await balance()).toBe("1000.00");
  });

  it("esgota as tentativas: REJECTED com codigo de referencia ausente e evento publicado", async () => {
    await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Refund, "refund-4", "bet-4"),
    );

    let lastBatch;
    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      lastBatch = await ctx.pendingReferences.retryDue(inMs(attempt * 60 * 60_000));
    }

    expect(lastBatch).toMatchObject({ rejected: 1, stillPending: 0 });
    const current = await row("refund-4");
    expect(current.status).toBe(WagerTransactionStatus.Rejected);
    expect(current.failure_code).toBe(FailureCode.ReferenceNotFound);
    expect(current.reference_attempts).toBe(MAX_REFERENCE_ATTEMPTS);

    const events = await ctx.outboxEvents();
    expect(events.map((event) => event.event_type).sort()).toEqual([
      "WagerTransactionPendingReference",
      "WagerTransactionRejected",
    ]);
    expect(await balance()).toBe("1000.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(0);
    expect(await ctx.ledgerCount(wallet.id, "CREDIT")).toBe(1);

    const again = await ctx.pendingReferences.retryDue(inMs(48 * 60 * 60_000));
    expect(again.checked).toBe(0);
  });

  it("referencia que chega com valor diferente: a devolucao pendente e rejeitada", async () => {
    await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Refund, "refund-5", "bet-5"),
    );
    await ctx.processTransaction.execute(bet("bet-5", "40.00"));

    await ctx.pendingReferences.retryDue(inMs(10_000));

    const current = await row("refund-5");
    expect(current.status).toBe(WagerTransactionStatus.Rejected);
    expect(current.failure_code).toBe(FailureCode.ReferenceAmountMismatch);
    expect(await balance()).toBe("960.00");
    await expectInvariant(ctx, wallet.id);
  });

  it("ROLLBACK que chega antes da aposta tambem e concluido depois", async () => {
    await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Rollback, "rollback-1", "bet-6"),
    );
    await ctx.processTransaction.execute(bet("bet-6"));

    await ctx.pendingReferences.retryDue(inMs(10_000));

    expect((await row("rollback-1")).status).toBe(WagerTransactionStatus.Processed);
    expect(await balance()).toBe("1000.00");
    await expectInvariant(ctx, wallet.id);
  });

  it("varios workers ao mesmo tempo aplicam a devolucao uma unica vez", async () => {
    await ctx.processTransaction.execute(
      reversal(WagerTransactionKind.Refund, "refund-7", "bet-7"),
    );
    await ctx.processTransaction.execute(bet("bet-7"));

    const at = inMs(10_000);
    const batches = await Promise.all(
      Array.from({ length: 6 }, () => ctx.pendingReferences.retryDue(at)),
    );

    expect(batches.reduce((sum, batch) => sum + batch.processed, 0)).toBe(1);
    expect(batches.reduce((sum, batch) => sum + batch.failed, 0)).toBe(0);
    expect(await balance()).toBe("1000.00");
    expect(await ctx.ledgerCount(wallet.id, "CREDIT")).toBe(2);
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    await expectInvariant(ctx, wallet.id);
  });

  it("aposta e devolucao chegando juntas, em qualquer ordem, terminam consistentes", async () => {
    const pairs = Array.from({ length: 12 }, (_, index) => index);

    await Promise.all(
      pairs.flatMap((index) => [
        ctx.processTransaction.execute(
          reversal(WagerTransactionKind.Refund, `race-refund-${index}`, `race-bet-${index}`),
        ),
        ctx.processTransaction.execute(bet(`race-bet-${index}`)),
      ]),
    );

    const batches = await Promise.all([
      ctx.pendingReferences.retryDue(inMs(60_000)),
      ctx.pendingReferences.retryDue(inMs(60_000)),
    ]);

    expect(batches.reduce((sum, batch) => sum + batch.failed, 0)).toBe(0);
    for (const index of pairs) {
      expect((await row(`race-refund-${index}`)).status).toBe(WagerTransactionStatus.Processed);
    }
    expect(await balance()).toBe("1000.00");
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(12);
    expect(await ctx.ledgerCount(wallet.id, "CREDIT")).toBe(13);
    await expectInvariant(ctx, wallet.id);
  });
});
