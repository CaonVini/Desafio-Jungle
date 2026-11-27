import { randomUUID } from "node:crypto";

interface Money {
  amount: string;
  currency: string;
}

interface WalletResponse {
  id: string;
  balance: Money;
}

interface ProcessResponse {
  transactionId: string;
  status: string;
  idempotentReplay: boolean;
}

interface ReconciliationResponse {
  consistent: boolean;
  checkedEntries: number;
}

interface BetRequest {
  index: number;
  walletId: string;
  playerId: string;
  key: string;
  body: string;
}

interface BetResult {
  httpStatus: number;
  millis: number;
  retries: number;
  response: ProcessResponse | undefined;
}

const BASE_URLS = (process.env["BASE_URLS"] ?? "http://localhost:3000")
  .split(",")
  .map((url) => url.trim().replace(/\/$/, ""))
  .filter((url) => url.length > 0);
const TOTAL = envInt("TOTAL", 500);
const WALLETS = envInt("WALLETS", 10);
const CONCURRENCY = envInt("CONCURRENCY", 50);
const INITIAL_UNITS = envInt("INITIAL_UNITS", 40);
const MAX_RETRIES = 5;
const RUN_ID = randomUUID().slice(0, 8);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} precisa ser um inteiro maior que zero`);
  }
  return value;
}

function baseUrl(index: number): string {
  return BASE_URLS[index % BASE_URLS.length] as string;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createWallet(index: number): Promise<{ id: string; playerId: string }> {
  const playerId = randomUUID();
  const response = await fetch(`${baseUrl(index)}/wallets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      playerId,
      initialBalance: { amount: `${INITIAL_UNITS}.00`, currency: "BRL" },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Não consegui criar a carteira (HTTP ${response.status})`);
  }
  const wallet = await readJson<WalletResponse>(response);
  return { id: wallet.id, playerId };
}

function buildBet(index: number, wallet: { id: string; playerId: string }): BetRequest {
  const key = `load-${RUN_ID}-${index}`;
  return {
    index,
    walletId: wallet.id,
    playerId: wallet.playerId,
    key,
    body: JSON.stringify({
      providerId: "load-test",
      externalTransactionId: key,
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: `round-${index}`,
      gameId: "game-1",
      kind: "BET",
      money: { amount: "1.00", currency: "BRL" },
    }),
  };
}

async function sendBet(bet: BetRequest): Promise<BetResult> {
  const startedAt = performance.now();
  let retries = 0;
  for (;;) {
    const response = await fetch(`${baseUrl(bet.index)}/wagering/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": bet.key },
      body: bet.body,
    });
    if (response.status === 503 && retries < MAX_RETRIES) {
      retries++;
      const wait = Number(response.headers.get("retry-after") ?? "1") * 1000;
      await response.arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    const parsed = response.status === 200 || response.status === 422 || response.status === 202;
    return {
      httpStatus: response.status,
      millis: performance.now() - startedAt,
      retries,
      response: parsed ? await readJson<ProcessResponse>(response) : undefined,
    };
  }
}

async function runPool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const position = next++;
      results[position] = await work(items[position] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function percentile(sorted: number[], fraction: number): number {
  const position = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, position)] as number;
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(16)}${value}`);
}

const failures: string[] = [];

function check(description: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "OK    " : "FALHOU"} ${description} (${detail})`);
  if (!ok) failures.push(description);
}

async function main(): Promise<void> {
  console.log("Teste de carga");
  line("instâncias", `${BASE_URLS.length} (${BASE_URLS.join(", ")})`);
  line("carteiras", `${WALLETS}, saldo inicial ${INITIAL_UNITS}.00`);
  line("apostas", `${TOTAL} de 1.00, concorrência ${CONCURRENCY}`);

  const wallets = await Promise.all(Array.from({ length: WALLETS }, (_, i) => createWallet(i)));
  const bets = Array.from({ length: TOTAL }, (_, i) => buildBet(i, wallets[i % WALLETS] as { id: string; playerId: string }));

  const startedAt = performance.now();
  const results = await runPool(bets, CONCURRENCY, sendBet);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;

  const latencies = results.map((r) => r.millis).sort((a, b) => a - b);
  const byStatus = new Map<number, number>();
  for (const result of results) {
    byStatus.set(result.httpStatus, (byStatus.get(result.httpStatus) ?? 0) + 1);
  }
  const retries = results.reduce((sum, r) => sum + r.retries, 0);

  console.log("\nResultado");
  line("tempo total", `${elapsedSeconds.toFixed(2)} s`);
  line("vazão", `${(TOTAL / elapsedSeconds).toFixed(1)} apostas/s`);
  line(
    "latência",
    `p50 ${percentile(latencies, 0.5).toFixed(0)} ms, p95 ${percentile(latencies, 0.95).toFixed(0)} ms, ` +
      `p99 ${percentile(latencies, 0.99).toFixed(0)} ms, máx ${(latencies.at(-1) as number).toFixed(0)} ms`,
  );
  line(
    "status HTTP",
    [...byStatus.entries()]
      .sort(([a], [b]) => a - b)
      .map(([status, count]) => `${status} x${count}`)
      .join(", "),
  );
  line("retries 503", String(retries));

  const replayCount = Math.max(1, Math.round(TOTAL / 10));
  const replayTargets = bets.filter((_, i) => i % Math.ceil(TOTAL / replayCount) === 0);
  const replays = await runPool(replayTargets, CONCURRENCY, sendBet);

  console.log("\nConferências");
  const perWallet = new Map<string, number>();
  for (const bet of bets) perWallet.set(bet.walletId, (perWallet.get(bet.walletId) ?? 0) + 1);

  let expectedAccepted = 0;
  for (const attempts of perWallet.values()) expectedAccepted += Math.min(attempts, INITIAL_UNITS);
  const accepted = byStatus.get(200) ?? 0;
  const rejected = byStatus.get(422) ?? 0;
  check("apostas aceitas", accepted === expectedAccepted, `${accepted}, esperado ${expectedAccepted}`);
  check(
    "apostas rejeitadas por saldo",
    rejected === TOTAL - expectedAccepted,
    `${rejected}, esperado ${TOTAL - expectedAccepted}`,
  );
  check("nenhuma resposta inesperada", accepted + rejected === TOTAL, `${accepted + rejected} de ${TOTAL}`);

  const replaysOk = replays.every(
    (replay, i) =>
      replay.response?.idempotentReplay === true &&
      replay.httpStatus === results[bets.indexOf(replayTargets[i] as BetRequest)]?.httpStatus,
  );
  check("repetições devolvem o resultado original", replaysOk, `${replays.length} repetidas`);

  for (const wallet of wallets) {
    const attempts = perWallet.get(wallet.id) ?? 0;
    const expected = `${INITIAL_UNITS - Math.min(attempts, INITIAL_UNITS)}.00`;
    const current = await readJson<WalletResponse>(await fetch(`${baseUrl(0)}/wallets/${wallet.id}`));
    const reconciliation = await readJson<ReconciliationResponse>(
      await fetch(`${baseUrl(0)}/wallets/${wallet.id}/reconciliation`, { method: "POST" }),
    );
    check(
      `carteira ${wallet.id.slice(-8)}`,
      current.balance.amount === expected && reconciliation.consistent,
      `saldo ${current.balance.amount}, esperado ${expected}, ledger ${reconciliation.consistent ? "bate" : "diverge"}`,
    );
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} conferência(s) falharam.`);
    process.exit(1);
  }
  console.log("\nTudo certo.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
