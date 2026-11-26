import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { v7 as uuidv7 } from "uuid";
import { WalletOutput } from "../../src/wallet/application/wallet.output";
import {
  AppProcess,
  createQueues,
  drainEventIds,
  freePort,
  postWager,
  Queues,
  queueDepth,
  startApp,
  startMany,
  stopAll,
  wagerBody,
  waitFor,
} from "../support/process-harness";
import { createTestContext, expectInvariant, TestContext } from "../support/test-context";

process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";

const TIMEOUT_MS = 180_000;

describe.skipIf(process.env.SKIP_SQS_TESTS === "1")(
  "recuperacao de falhas (processos reais)",
  () => {
    let ctx: TestContext;
    let queues: Queues;
    let running: AppProcess[] = [];

    beforeAll(async () => {
      ctx = await createTestContext();
    }, TIMEOUT_MS);

    afterAll(async () => {
      await ctx?.close();
    });

    beforeEach(async () => {
      await ctx.reset();
      queues = await createQueues(5);
      running = [];
    });

    afterEach(async () => {
      await stopAll(running);
      await queues.destroy();
    });

    function openWallet(amount: string): Promise<WalletOutput> {
      return ctx.createWallet.execute({
        playerId: uuidv7(),
        initialBalance: { amount, currency: "BRL" },
      });
    }

    function messageBody(
      wallet: WalletOutput,
      externalTransactionId: string,
      amount = "1.00",
    ): {
      body: string;
      messageId: string;
    } {
      const messageId = uuidv7();
      const body = JSON.stringify({
        messageId,
        type: "WagerTransactionRequested",
        occurredAt: new Date().toISOString(),
        data: {
          providerId: "provider-a",
          externalTransactionId,
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: "round-1",
          gameId: "game-1",
          kind: "BET",
          money: { amount, currency: "BRL" },
        },
      });
      return { body, messageId };
    }

    async function send(
      wallet: WalletOutput,
      message: { body: string; messageId: string },
    ): Promise<void> {
      await queues.client.send(
        new SendMessageCommand({
          QueueUrl: queues.transactionsUrl,
          MessageBody: message.body,
          MessageGroupId: wallet.id,
          MessageDeduplicationId: message.messageId,
        }),
      );
    }

    async function count(sql: string): Promise<number> {
      const rows = await ctx.dataSource.query(sql);
      return rows[0].total as number;
    }

    async function start(count: number): Promise<AppProcess[]> {
      const apps = await startMany(count, { queues });
      running.push(...apps);
      return apps;
    }

    for (const signal of ["SIGKILL", "SIGTERM"] as const) {
      it(
        `${signal} em todos os processos no meio do trafego: reinicia e cada operacao vale uma vez`,
        async () => {
          const wallets = await Promise.all(Array.from({ length: 4 }, () => openWallet("1000.00")));
          const perWallet = 30;
          const duplicatesPerWallet = 5;

          for (const [walletIndex, wallet] of wallets.entries()) {
            const sends: Promise<void>[] = [];
            for (let bet = 0; bet < perWallet; bet++) {
              sends.push(send(wallet, messageBody(wallet, `w${walletIndex}-b${bet}`)));
            }
            for (let bet = 0; bet < duplicatesPerWallet; bet++) {
              sends.push(send(wallet, messageBody(wallet, `w${walletIndex}-b${bet}`)));
            }
            await Promise.all(sends);
          }
          const totalMessages = wallets.length * (perWallet + duplicatesPerWallet);
          const totalBets = wallets.length * perWallet;

          const first = await start(3);
          await waitFor(
            "alguns debitos antes de matar",
            async () =>
              (await count(
                "SELECT count(*)::int AS total FROM wallet_ledger_entries WHERE direction::text = 'DEBIT'",
              )) >= 10,
            60_000,
            20,
          );
          first.forEach((app) => app.kill(signal));
          await Promise.all(first.map((app) => app.exited));
          const debitsAtKill = await count(
            "SELECT count(*)::int AS total FROM wallet_ledger_entries WHERE direction::text = 'DEBIT'",
          );
          expect(debitsAtKill).toBeGreaterThanOrEqual(10);
          expect(debitsAtKill).toBeLessThan(totalBets);

          await start(3);
          await waitFor(
            "fila de transacoes esvaziar",
            async () => (await queueDepth(queues.client, queues.transactionsUrl)) === 0,
            90_000,
            500,
          );

          for (const wallet of wallets) {
            expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(perWallet);
            expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("970.00");
            await expectInvariant(ctx, wallet.id);
          }
          expect(await ctx.inboxCount()).toBe(totalMessages);
          expect(await queueDepth(queues.client, queues.dlqUrl)).toBe(0);
          expect(
            await count(
              "SELECT count(*)::int AS total FROM wager_transactions WHERE kind::text <> 'OPENING'",
            ),
          ).toBe(totalBets);

          await waitFor(
            "outbox sem pendentes",
            async () =>
              (await count(
                "SELECT count(*)::int AS total FROM outbox_events WHERE status <> 'PUBLISHED'",
              )) === 0,
            30_000,
            500,
          );
          const outboxIds: { id: string }[] = await ctx.dataSource.query(
            "SELECT id FROM outbox_events",
          );
          expect(outboxIds).toHaveLength(totalBets * 2);
          const received = new Set(await drainEventIds(queues.client, queues.eventsUrl));
          for (const row of outboxIds) {
            expect(received.has(row.id)).toBe(true);
          }
        },
        TIMEOUT_MS,
      );
    }

    it(
      "commit feito e ack perdido: a mensagem volta, o inbox reconhece e nao debita de novo",
      async () => {
        const wallet = await openWallet("100.00");
        const message = messageBody(wallet, "commit-sem-ack", "25.00");
        await send(wallet, message);

        await ctx.consumer.consume(message.body);
        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
        expect(await queueDepth(queues.client, queues.transactionsUrl)).toBe(1);

        await start(1);
        await waitFor(
          "fila de transacoes esvaziar",
          async () => (await queueDepth(queues.client, queues.transactionsUrl)) === 0,
          30_000,
          250,
        );

        expect(await ctx.ledgerCount(wallet.id, "DEBIT")).toBe(1);
        expect((await ctx.getWallet.execute(wallet.id)).balance.amount).toBe("75.00");
        expect(await ctx.inboxCount()).toBe(1);
        expect(await queueDepth(queues.client, queues.dlqUrl)).toBe(0);
        await expectInvariant(ctx, wallet.id);
      },
      TIMEOUT_MS,
    );

    it(
      "publicador morto no meio do lote: outro processo termina e nenhum evento se perde",
      async () => {
        const wallet = await openWallet("1000.00");
        const writer = await startApp({ port: freePort(), workers: false });
        running.push(writer);
        const total = 30;
        for (let bet = 0; bet < total; bet++) {
          const result = await postWager(writer, wagerBody(wallet, `pub-${bet}`, "1.00"));
          expect(result.status).toBe(200);
        }
        await writer.stop();
        const expectedEvents = total * 2;
        expect(
          await count("SELECT count(*)::int AS total FROM outbox_events WHERE status = 'PENDING'"),
        ).toBe(expectedEvents);

        const publishers = await startMany(2, {
          queues,
          workers: false,
          env: { OUTBOX_WORKER_ENABLED: "true", OUTBOX_POLL_INTERVAL_MS: "50" },
        });
        running.push(...publishers);
        await waitFor(
          "eventos chegando na fila",
          async () => (await queueDepth(queues.client, queues.eventsUrl)) >= 3,
          30_000,
          20,
        );
        publishers.forEach((app) => app.kill("SIGKILL"));
        await Promise.all(publishers.map((app) => app.exited));

        const [recovery] = await startMany(1, {
          queues,
          workers: false,
          env: { OUTBOX_WORKER_ENABLED: "true" },
        });
        running.push(recovery as AppProcess);
        await waitFor(
          "outbox sem pendentes",
          async () =>
            (await count(
              "SELECT count(*)::int AS total FROM outbox_events WHERE status <> 'PUBLISHED'",
            )) === 0,
          60_000,
          250,
        );

        const outboxIds: { id: string }[] = await ctx.dataSource.query(
          "SELECT id FROM outbox_events",
        );
        expect(outboxIds).toHaveLength(expectedEvents);
        const received = await drainEventIds(queues.client, queues.eventsUrl);
        const distinct = new Set(received);
        for (const row of outboxIds) {
          expect(distinct.has(row.id)).toBe(true);
        }
        expect(received.length).toBeGreaterThanOrEqual(expectedEvents);
        await expectInvariant(ctx, wallet.id);
      },
      TIMEOUT_MS,
    );
  },
);
