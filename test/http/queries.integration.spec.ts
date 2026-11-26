import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction.enums";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import { transactionInput } from "../support/fixtures";
import { createTestContext, TestContext } from "../support/test-context";

describe("Consultas HTTP (integration)", () => {
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

  async function get(path: string): Promise<{ status: number; body: any }> {
    const response = await fetch(`${baseUrl}${path}`);
    return { status: response.status, body: await response.json() };
  }

  async function post(input: ReturnType<typeof transactionInput>): Promise<any> {
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": input.idempotencyKey },
      body: JSON.stringify({
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money: input.money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      }),
    });
    return { status: response.status, body: await response.json() };
  }

  function bet(amount: string) {
    return transactionInput(wallet, { money: { amount, currency: "BRL" } });
  }

  describe("POST /wagering/transactions", () => {
    it("devolve transactionId, status, balance e idempotentReplay", async () => {
      const { status, body } = await post(bet("25.00"));

      expect(status).toBe(200);
      expect(body).toMatchObject({
        status: "PROCESSED",
        balance: { amount: "75.00", currency: "BRL" },
        idempotentReplay: false,
      });
      expect(body.transactionId).toBe(body.transaction.id);
    });

    it("o replay devolve o saldo daquele momento, nao o saldo atual", async () => {
      const first = bet("25.00");
      await post(first);
      await post(bet("10.00"));

      const replay = await post(first);

      expect(replay.body.idempotentReplay).toBe(true);
      expect(replay.body.balance.amount).toBe("75.00");
      expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("65.00");
    });

    it("rejeicao por saldo insuficiente guarda o saldo observado e o failureCode", async () => {
      const { status, body } = await post(bet("500.00"));

      expect(status).toBe(422);
      expect(body).toMatchObject({
        status: "REJECTED",
        failureCode: "INSUFFICIENT_FUNDS",
        balance: { amount: "100.00", currency: "BRL" },
      });
    });

    it("LOSS devolve o saldo sem alteracao", async () => {
      const { body } = await post(transactionInput(wallet, { kind: WagerTransactionKind.Loss }));

      expect(body.status).toBe("PROCESSED");
      expect(body.balance.amount).toBe("100.00");
    });
  });

  describe("GET transacao", () => {
    it("por id interno", async () => {
      const created = await post(bet("25.00"));

      const { status, body } = await get(`/wagering/transactions/${created.body.transactionId}`);

      expect(status).toBe(200);
      expect(body).toMatchObject({
        id: created.body.transactionId,
        status: "PROCESSED",
        kind: "BET",
        balance: { amount: "75.00", currency: "BRL" },
      });
    });

    it("por provedor e id externo", async () => {
      const input = bet("25.00");
      const created = await post(input);

      const { status, body } = await get(
        `/providers/${input.providerId}/wagering/transactions/${input.externalTransactionId}`,
      );

      expect(status).toBe(200);
      expect(body.id).toBe(created.body.transactionId);
    });

    it("404 quando nao existe e 400 para id invalido", async () => {
      const missing = await get(`/wagering/transactions/${uuidv7()}`);
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe("TRANSACTION_NOT_FOUND");

      const missingByProvider = await get("/providers/prov-x/wagering/transactions/nao-existe");
      expect(missingByProvider.status).toBe(404);

      const invalid = await get("/wagering/transactions/nao-e-uuid");
      expect(invalid.status).toBe(400);
    });

    it("transacao pendente de referencia aparece como PENDING_REFERENCE", async () => {
      const input = transactionInput(wallet, {
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: "bet-que-nao-chegou",
      });
      const created = await post(input);

      expect(created.status).toBe(202);
      const { body } = await get(`/wagering/transactions/${created.body.transactionId}`);
      expect(body.status).toBe("PENDING_REFERENCE");
      expect(body.balance.amount).toBe("100.00");
    });
  });

  describe("GET /wallets/:id/ledger", () => {
    async function seed(count: number): Promise<void> {
      for (let index = 0; index < count; index++) {
        await ctx.processTransaction.execute(bet("5.00"));
      }
    }

    async function readAll(limit: number): Promise<any[][]> {
      const pages: any[][] = [];
      let cursor: string | null = null;
      do {
        const query: string = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const { status, body } = await get(`/wallets/${wallet.id}/ledger?${query}`);
        expect(status).toBe(200);
        pages.push(body.items);
        cursor = body.nextCursor;
      } while (cursor);
      return pages;
    }

    it("pagina do mais novo para o mais antigo, sem repetir nem pular entradas", async () => {
      await seed(7);

      const pages = await readAll(3);
      const entries = pages.flat();

      expect(pages.map((page) => page.length)).toEqual([3, 3, 2]);
      expect(new Set(entries.map((entry) => entry.id)).size).toBe(8);
      expect(entries[0].balanceAfter.amount).toBe("65.00");
      expect(entries.at(-1).direction).toBe("CREDIT");
      expect(entries.at(-1).balanceBefore.amount).toBe("0.00");
    });

    it("a cadeia de saldos fecha: balanceBefore de cada entrada e o balanceAfter da anterior", async () => {
      await seed(6);

      const entries = (await readAll(50)).flat();

      for (let index = 0; index < entries.length - 1; index++) {
        expect(entries[index].balanceBefore.amount).toBe(entries[index + 1].balanceAfter.amount);
      }
    });

    it("a cadeia de saldos fecha mesmo com apostas concorrentes na mesma wallet", async () => {
      await Promise.all(
        Array.from({ length: 15 }, () => ctx.processTransaction.execute(bet("5.00"))),
      );

      const entries = (await readAll(4)).flat();

      expect(entries).toHaveLength(16);
      for (let index = 0; index < entries.length - 1; index++) {
        expect(entries[index].balanceBefore.amount).toBe(entries[index + 1].balanceAfter.amount);
      }
      expect(entries[0].balanceAfter.amount).toBe("25.00");
    });

    it("o cursor e estavel: entradas novas nao deslocam as paginas seguintes", async () => {
      await seed(5);
      const first = await get(`/wallets/${wallet.id}/ledger?limit=2`);
      const firstIds = first.body.items.map((entry: { id: string }) => entry.id);

      await seed(3);
      const second = await get(
        `/wallets/${wallet.id}/ledger?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      );
      const secondIds = second.body.items.map((entry: { id: string }) => entry.id);

      expect(secondIds).toHaveLength(2);
      expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
      const all = await readAll(50);
      const ordered = all.flat().map((entry) => entry.id);
      expect(ordered.indexOf(secondIds[0])).toBe(ordered.indexOf(firstIds[1]) + 1);
    });

    it("sem nextCursor quando cabe tudo numa pagina e limite padrao de 50", async () => {
      await seed(2);

      const { body } = await get(`/wallets/${wallet.id}/ledger`);

      expect(body.items).toHaveLength(3);
      expect(body.nextCursor).toBeNull();
    });

    it("limite e cursor invalidos dao 400; wallet inexistente da 404", async () => {
      for (const query of [
        "limit=0",
        "limit=101",
        "limit=abc",
        "limit=-1",
        "cursor=lixo",
        "cursor=",
      ]) {
        const { status } = await get(`/wallets/${wallet.id}/ledger?${query}`);
        expect(status).toBe(400);
      }
      const forged = Buffer.from(
        JSON.stringify({ t: "1; DROP TABLE wallets", i: wallet.id }),
      ).toString("base64url");
      expect((await get(`/wallets/${wallet.id}/ledger?cursor=${forged}`)).status).toBe(400);

      expect((await get(`/wallets/${uuidv7()}/ledger`)).status).toBe(404);
      expect((await get("/wallets/nao-e-uuid/ledger")).status).toBe(400);
    });
  });
});
