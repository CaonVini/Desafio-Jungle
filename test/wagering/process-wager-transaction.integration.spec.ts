import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { WagerTransactionKind, WagerTransactionStatus, FailureCode } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

describe("ProcessWagerTransaction (integration)", () => {
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

  it("BET debita o saldo e registra o lancamento", async () => {
    const result = await ctx.processTransaction.execute(transactionInput(wallet));

    expect(result.idempotentReplay).toBe(false);
    expect(result.transaction.status).toBe(WagerTransactionStatus.Processed);

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("975.00");
    expect(current.version).toBe(2);
    expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
    await expectInvariant(ctx, wallet.id);
  });

  it("repetir a mesma requisicao devolve replay sem debitar de novo", async () => {
    const input = transactionInput(wallet);
    const first = await ctx.processTransaction.execute(input);
    const second = await ctx.processTransaction.execute(input);

    expect(second.idempotentReplay).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("975.00");
    await expectInvariant(ctx, wallet.id);
  });

  it("mesma chave com payload diferente e conflito", async () => {
    const input = transactionInput(wallet);
    await ctx.processTransaction.execute(input);

    await expect(
      ctx.processTransaction.execute({ ...input, money: { amount: "30.00", currency: "BRL" } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("975.00");
  });

  it("saldo insuficiente grava REJECTED sem lancamento e sem mexer no saldo", async () => {
    const result = await ctx.processTransaction.execute(
      transactionInput(wallet, { money: { amount: "5000.00", currency: "BRL" } }),
    );

    expect(result.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.transaction.failureCode).toBe(FailureCode.InsufficientFunds);

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("1000.00");
    expect(current.version).toBe(1);
    expect(await ctx.ledgerCount(wallet.id)).toBe(1);
  });

  it("jogador diferente do dono da wallet e rejeitado", async () => {
    const result = await ctx.processTransaction.execute(
      transactionInput(wallet, { playerId: uuidv7() }),
    );

    expect(result.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.transaction.failureCode).toBe(FailureCode.WalletPlayerMismatch);
  });

  it("WIN credita e LOSS nao altera o saldo", async () => {
    const win = await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Win,
        money: { amount: "50.00", currency: "BRL" },
      }),
    );
    expect(win.transaction.status).toBe(WagerTransactionStatus.Processed);

    const loss = await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Loss,
        money: { amount: "0.00", currency: "BRL" },
      }),
    );
    expect(loss.transaction.status).toBe(WagerTransactionStatus.Processed);

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("1050.00");
    expect(await ctx.ledgerCount(wallet.id)).toBe(2);
    await expectInvariant(ctx, wallet.id);
  });

  it("REFUND devolve a aposta uma unica vez", async () => {
    await ctx.processTransaction.execute(
      transactionInput(wallet, { externalTransactionId: "bet-1" }),
    );

    const refund = await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "bet-1",
      }),
    );
    expect(refund.transaction.status).toBe(WagerTransactionStatus.Processed);

    const again = await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "bet-1",
      }),
    );
    expect(again.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(again.transaction.failureCode).toBe(FailureCode.AlreadyReversed);

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("1000.00");
    await expectInvariant(ctx, wallet.id);
  });

  it("ROLLBACK sem a original fica PENDING_REFERENCE sem mexer no saldo", async () => {
    const result = await ctx.processTransaction.execute(
      transactionInput(wallet, {
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: "ainda-nao-chegou",
      }),
    );

    expect(result.transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(result.transaction.nextAttemptAt).toBeDefined();

    const current = await ctx.getWallet.execute(wallet.id);
    expect(current.balance.amount).toBe("1000.00");
    expect(await ctx.ledgerCount(wallet.id)).toBe(1);
  });
});