import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Logger } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { JsonLogger } from "../../src/shared/logging/json-logger";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, TestContext } from "../support/test-context";

const ORIGINAL_ENV = {
  endpoint: process.env.SQS_ENDPOINT,
  queueUrl: process.env.SQS_TRANSACTIONS_QUEUE_URL,
  accessKey: process.env.AWS_ACCESS_KEY_ID,
  secretKey: process.env.AWS_SECRET_ACCESS_KEY,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("HTTP (integration)", () => {
  let ctx: TestContext;
  let baseUrl: string;
  let wallet: WalletOutput;

  beforeAll(async () => {
    process.env.SQS_ENDPOINT = "http://127.0.0.1:9";
    process.env.SQS_TRANSACTIONS_QUEUE_URL =
      "http://127.0.0.1:9/000000000000/wager-transactions.fifo";
    process.env.AWS_ACCESS_KEY_ID ??= "test";
    process.env.AWS_SECRET_ACCESS_KEY ??= "test";

    ctx = await createTestContext();
    baseUrl = await ctx.startHttp();
  });

  afterAll(async () => {
    await ctx.close();
    restoreEnv("SQS_ENDPOINT", ORIGINAL_ENV.endpoint);
    restoreEnv("SQS_TRANSACTIONS_QUEUE_URL", ORIGINAL_ENV.queueUrl);
    restoreEnv("AWS_ACCESS_KEY_ID", ORIGINAL_ENV.accessKey);
    restoreEnv("AWS_SECRET_ACCESS_KEY", ORIGINAL_ENV.secretKey);
  });

  beforeEach(async () => {
    await ctx.reset();
    wallet = await ctx.createWallet.execute({
      playerId: uuidv7(),
      initialBalance: { amount: "100.00", currency: "BRL" },
    });
  });

  async function call(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const init: RequestInit = {
      method,
      headers: { "content-type": "application/json", ...options.headers },
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${baseUrl}${path}`, init);
    return { status: response.status, body: await response.json(), headers: response.headers };
  }

  describe("reconciliacao", () => {
    it("carteira consistente: saldo guardado igual ao saldo reconstruido do ledger", async () => {
      await ctx.processTransaction.execute(transactionInput(wallet));
      await ctx.processTransaction.execute(
        transactionInput(wallet, {
          kind: WagerTransactionKind.Win,
          money: { amount: "10.00", currency: "BRL" },
        }),
      );

      const response = await call("POST", `/wallets/${wallet.id}/reconciliation`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        storedBalance: { amount: "85.00", currency: "BRL" },
        calculatedBalance: { amount: "85.00", currency: "BRL" },
        difference: { amount: "0.00", currency: "BRL" },
        consistent: true,
        checkedEntries: 3,
      });
    });

    it("carteira sem lancamentos continua consistente", async () => {
      const empty = await ctx.createWallet.execute({
        playerId: uuidv7(),
        initialBalance: { amount: "0.00", currency: "BRL" },
      });

      const response = await call("POST", `/wallets/${empty.id}/reconciliation`);

      expect(response.body).toMatchObject({ consistent: true, checkedEntries: 0 });
      expect(response.body.calculatedBalance.amount).toBe("0.00");
    });

    it("continua consistente depois de apostas concorrentes disputando o saldo", async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          ctx.processTransaction.execute(
            transactionInput(wallet, { money: { amount: "10.00", currency: "BRL" } }),
          ),
        ),
      );

      const processed = results.filter((r) => r.transaction.status === "PROCESSED");
      const response = await call("POST", `/wallets/${wallet.id}/reconciliation`);

      expect(processed).toHaveLength(10);
      expect(response.body.consistent).toBe(true);
      expect(response.body.storedBalance.amount).toBe("0.00");
      expect(response.body.checkedEntries).toBe(11);
    });

    it("divergencia: sinaliza, registra no log e NAO corrige o saldo", async () => {
      await ctx.dataSource.query("UPDATE wallets SET balance = balance + 10 WHERE id = $1", [
        wallet.id,
      ]);
      const errorLog = spyOn(Logger.prototype, "error");

      const first = await call("POST", `/wallets/${wallet.id}/reconciliation`);
      const second = await call("POST", `/wallets/${wallet.id}/reconciliation`);

      expect(first.body).toEqual({
        storedBalance: { amount: "110.00", currency: "BRL" },
        calculatedBalance: { amount: "100.00", currency: "BRL" },
        difference: { amount: "10.00", currency: "BRL" },
        consistent: false,
        checkedEntries: 1,
      });
      expect(second.body.consistent).toBe(false);
      expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("110.00");
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({ message: "reconciliation.divergence", walletId: wallet.id }),
      );
      errorLog.mockRestore();
    });

    it("wallet inexistente da 404 e id invalido da 400", async () => {
      const missing = await call("POST", `/wallets/${uuidv7()}/reconciliation`);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe("WALLET_NOT_FOUND");

      const invalid = await call("POST", "/wallets/nao-e-uuid/reconciliation");
      expect(invalid.status).toBe(400);
      expect(invalid.body.code).toBe("INVALID_PAYLOAD");
    });
  });

  describe("health", () => {
    it("live responde 200 sem depender de nada", async () => {
      const response = await call("GET", "/health/live");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
    });

    it("ready responde 503 e aponta o SQS quando ele esta inacessivel", async () => {
      const response = await call("GET", "/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: "unavailable",
        checks: { postgres: "up", sqs: "down" },
      });
    }, 15_000);
  });

  describe("logs e correlationId", () => {
    it("devolve o correlationId recebido, gera um novo se faltar ou for invalido", async () => {
      const given = await call("GET", "/health/live", {
        headers: { "x-correlation-id": "abc-123" },
      });
      expect(given.headers.get("x-correlation-id")).toBe("abc-123");

      const missing = await call("GET", "/health/live");
      expect(missing.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);

      const invalid = await call("GET", "/health/live", {
        headers: { "x-correlation-id": "tem espaco e <script>" },
      });
      expect(invalid.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("a transacao via HTTP gera log JSON com correlationId e os ids, sem valores", async () => {
      const lines: Record<string, unknown>[] = [];
      const previous = (Logger as unknown as { staticInstanceRef: never }).staticInstanceRef;
      Logger.overrideLogger(new JsonLogger((line) => lines.push(JSON.parse(line))));

      try {
        const input = transactionInput(wallet);
        const response = await call("POST", "/wagering/transactions", {
          headers: { "idempotency-key": input.idempotencyKey, "x-correlation-id": "corr-http-1" },
          body: {
            providerId: input.providerId,
            externalTransactionId: input.externalTransactionId,
            walletId: wallet.id,
            playerId: wallet.playerId,
            roundId: input.roundId,
            gameId: input.gameId,
            kind: input.kind,
            money: input.money,
          },
        });
        expect(response.status).toBe(200);

        const log = lines.find((line) => line.message === "transaction.processed");
        expect(log).toMatchObject({
          level: "info",
          correlationId: "corr-http-1",
          walletId: wallet.id,
          providerId: input.providerId,
          transactionId: response.body.transaction.id,
          idempotentReplay: false,
        });
        expect(JSON.stringify(log)).not.toContain("25.00");
      } finally {
        Logger.overrideLogger(previous);
      }
    });
  });
});
