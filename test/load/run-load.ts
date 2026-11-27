import { randomUUID } from 'node:crypto';
import os from 'node:os';

const URLS = (process.env['BASE_URLS'] ?? 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim().replace(/\/$/, ''));
const TOTAL = intFromEnv('TOTAL', 500);
const WALLETS = intFromEnv('WALLETS', 10);
const CONCURRENCY = intFromEnv('CONCURRENCY', 50);
const INITIAL_UNITS = intFromEnv('INITIAL_UNITS', 40);
const MAX_RETRIES_ON_503 = 5;
const OUTBOX_TIMEOUT_MS = 60_000;
const RUN_ID = randomUUID().slice(0, 8);

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} precisa ser um inteiro maior que zero`);
  }
  return value;
}

interface Wallet {
  id: string;
  playerId: string;
}

interface Bet {
  index: number;
  wallet: Wallet;
  idempotencyKey: string;
}

interface BetOutcome {
  httpStatus: number;
  isReplay: boolean;
  millis: number;
  retries: number;
}

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`Posição ${index} não existe`);
  return item;
}

function urlFor(index: number): string {
  return at(URLS, index % URLS.length);
}

function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

async function runInParallel<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const position = next++;
      results[position] = await work(at(items, position));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function percentile(sorted: readonly number[], fraction: number): number {
  const position = Math.ceil(sorted.length * fraction) - 1;
  return at(sorted, Math.max(0, position));
}

async function createWallet(index: number): Promise<Wallet> {
  const playerId = randomUUID();
  const response = await fetch(`${urlFor(index)}/wallets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId,
      initialBalance: { amount: `${INITIAL_UNITS}.00`, currency: 'BRL' },
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Não consegui criar a carteira (HTTP ${response.status})`);
  }
  const wallet = (await response.json()) as { id: string };
  return { id: wallet.id, playerId };
}

async function placeBet(bet: Bet): Promise<BetOutcome> {
  const startedAt = performance.now();
  const body = JSON.stringify({
    providerId: 'load-test',
    externalTransactionId: bet.idempotencyKey,
    walletId: bet.wallet.id,
    playerId: bet.wallet.playerId,
    roundId: `round-${bet.index}`,
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '1.00', currency: 'BRL' },
  });

  let retries = 0;
  for (;;) {
    const response = await fetch(`${urlFor(bet.index)}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': bet.idempotencyKey,
      },
      body,
    });

    if (response.status === 503 && retries < MAX_RETRIES_ON_503) {
      retries++;
      await response.arrayBuffer();
      await sleep(Number(response.headers.get('retry-after') ?? '1') * 1000);
      continue;
    }

    const hasBody = [200, 202, 422].includes(response.status);
    const parsed = hasBody
      ? ((await response.json()) as { idempotentReplay?: boolean })
      : undefined;
    return {
      httpStatus: response.status,
      isReplay: parsed?.idempotentReplay === true,
      millis: performance.now() - startedAt,
      retries,
    };
  }
}

async function getBalance(wallet: Wallet): Promise<string> {
  const response = await fetch(`${urlFor(0)}/wallets/${wallet.id}`);
  const data = (await response.json()) as { balance: { amount: string } };
  return data.balance.amount;
}

async function isLedgerConsistent(wallet: Wallet): Promise<boolean> {
  const response = await fetch(
    `${urlFor(0)}/wallets/${wallet.id}/reconciliation`,
    { method: 'POST' },
  );
  const data = (await response.json()) as { consistent: boolean };
  return data.consistent;
}

async function readMetric(url: string, name: string): Promise<number> {
  const text = await (await fetch(`${url}/metrics`)).text();
  let total = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith(`${name} `) || line.startsWith(`${name}{`)) {
      total += Number(line.slice(line.lastIndexOf(' ') + 1));
    }
  }
  return total;
}

async function totalLockConflicts(): Promise<number | undefined> {
  if (URLS.length < 2) return undefined;
  let total = 0;
  for (const url of URLS)
    total += await readMetric(url, 'wager_lock_conflicts_total');
  return total;
}

interface OutboxReport {
  pendingAtStart: number;
  maxLagSeconds: number;
  drainedAfterSeconds: number | undefined;
}

async function watchOutbox(): Promise<OutboxReport> {
  const startedAt = performance.now();
  const url = urlFor(0);
  const pendingAtStart = await readMetric(url, 'wager_outbox_pending_events');
  let maxLagSeconds = 0;

  while (performance.now() - startedAt < OUTBOX_TIMEOUT_MS) {
    maxLagSeconds = Math.max(
      maxLagSeconds,
      await readMetric(url, 'wager_outbox_lag_seconds'),
    );
    if ((await readMetric(url, 'wager_outbox_pending_events')) === 0) {
      return {
        pendingAtStart,
        maxLagSeconds,
        drainedAfterSeconds: (performance.now() - startedAt) / 1000,
      };
    }
    await sleep(500);
  }
  return { pendingAtStart, maxLagSeconds, drainedAfterSeconds: undefined };
}

const failures: string[] = [];

function print(label: string, value: string): void {
  console.log(`  ${label.padEnd(16)}${value}`);
}

function check(description: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? 'OK    ' : 'FALHOU'} ${description} (${detail})`);
  if (!ok) failures.push(description);
}

function printEnvironment(): void {
  console.log('Teste de carga');
  print('instâncias', `${URLS.length} (${URLS.join(', ')})`);
  print('carteiras', `${WALLETS}, saldo inicial ${INITIAL_UNITS}.00`);
  print('apostas', `${TOTAL} de 1.00, concorrência ${CONCURRENCY}`);
  const ramGb = (os.totalmem() / 1024 ** 3).toFixed(0);
  print(
    'máquina',
    `${os.platform()} ${os.arch()}, ${os.cpus().length} CPUs, ${ramGb} GB de RAM, Bun ${process.versions['bun'] ?? '?'}`,
  );
}

function printLoadResult(
  outcomes: readonly BetOutcome[],
  elapsedSeconds: number,
  conflicts: number | undefined,
): void {
  const latencies = outcomes.map((o) => o.millis).sort((a, b) => a - b);
  const countByStatus = new Map<number, number>();
  for (const outcome of outcomes) {
    countByStatus.set(
      outcome.httpStatus,
      (countByStatus.get(outcome.httpStatus) ?? 0) + 1,
    );
  }
  const errors = outcomes.filter(
    (o) => ![200, 202, 422].includes(o.httpStatus),
  ).length;
  const statusText = [...countByStatus.entries()]
    .sort(([a], [b]) => a - b)
    .map(([status, count]) => `${status} x${count}`)
    .join(', ');

  console.log('\nResultado');
  print('tempo total', `${elapsedSeconds.toFixed(2)} s`);
  print('vazão', `${(TOTAL / elapsedSeconds).toFixed(1)} apostas/s`);
  print(
    'latência',
    `p50 ${percentile(latencies, 0.5).toFixed(0)} ms, p95 ${percentile(latencies, 0.95).toFixed(0)} ms, ` +
      `p99 ${percentile(latencies, 0.99).toFixed(0)} ms, máx ${percentile(latencies, 1).toFixed(0)} ms`,
  );
  print('status HTTP', statusText);
  print('retries 503', String(outcomes.reduce((sum, o) => sum + o.retries, 0)));
  print(
    'taxa de erro',
    `${((errors / TOTAL) * 100).toFixed(1)}% (${errors} de ${TOTAL})`,
  );
  print(
    'conflitos lock',
    conflicts === undefined
      ? 'n/d (precisa de um endereço por instância)'
      : String(conflicts),
  );
}

function printOutbox(outbox: OutboxReport): void {
  const drained =
    outbox.drainedAfterSeconds === undefined
      ? `não esvaziou em ${OUTBOX_TIMEOUT_MS / 1000} s`
      : `esvaziou em ${outbox.drainedAfterSeconds.toFixed(1)} s`;
  print(
    'outbox',
    `${outbox.pendingAtStart} eventos pendentes ao fim da carga, lag máx ${outbox.maxLagSeconds.toFixed(1)} s, ${drained}`,
  );
}

async function main(): Promise<void> {
  printEnvironment();

  const wallets = await Promise.all(
    Array.from({ length: WALLETS }, (_, i) => createWallet(i)),
  );
  const bets: Bet[] = Array.from({ length: TOTAL }, (_, index) => ({
    index,
    wallet: at(wallets, index % WALLETS),
    idempotencyKey: `load-${RUN_ID}-${index}`,
  }));

  const conflictsBefore = await totalLockConflicts();
  const startedAt = performance.now();
  const outcomes = await runInParallel(bets, CONCURRENCY, placeBet);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const conflictsAfter = await totalLockConflicts();
  const conflicts =
    conflictsBefore === undefined || conflictsAfter === undefined
      ? undefined
      : conflictsAfter - conflictsBefore;
  printLoadResult(outcomes, elapsedSeconds, conflicts);

  const step = Math.max(
    1,
    Math.floor(TOTAL / Math.max(1, Math.round(TOTAL / 10))),
  );
  const replayed = bets.filter((bet) => bet.index % step === 0);
  const replays = await runInParallel(replayed, CONCURRENCY, placeBet);

  const outbox = await watchOutbox();
  printOutbox(outbox);

  console.log('\nConferências');
  const betsPerWallet = new Map<string, number>();
  for (const bet of bets)
    betsPerWallet.set(
      bet.wallet.id,
      (betsPerWallet.get(bet.wallet.id) ?? 0) + 1,
    );

  let expectedAccepted = 0;
  for (const count of betsPerWallet.values())
    expectedAccepted += Math.min(count, INITIAL_UNITS);
  const accepted = outcomes.filter((o) => o.httpStatus === 200).length;
  const rejected = outcomes.filter((o) => o.httpStatus === 422).length;
  check(
    'apostas aceitas',
    accepted === expectedAccepted,
    `${accepted}, esperado ${expectedAccepted}`,
  );
  check(
    'apostas rejeitadas por saldo',
    rejected === TOTAL - expectedAccepted,
    `${rejected}, esperado ${TOTAL - expectedAccepted}`,
  );
  check(
    'nenhuma resposta inesperada',
    accepted + rejected === TOTAL,
    `${accepted + rejected} de ${TOTAL}`,
  );

  const replaysOk = replays.every(
    (replay, i) =>
      replay.isReplay &&
      replay.httpStatus === at(outcomes, at(replayed, i).index).httpStatus,
  );
  check(
    'repetições devolvem o resultado original',
    replaysOk,
    `${replays.length} repetidas`,
  );
  check(
    'outbox publicou todos os eventos',
    outbox.drainedAfterSeconds !== undefined,
    outbox.drainedAfterSeconds === undefined
      ? 'ainda havia pendentes'
      : 'nenhum pendente',
  );

  for (const wallet of wallets) {
    const attempts = betsPerWallet.get(wallet.id) ?? 0;
    const expectedBalance = `${INITIAL_UNITS - Math.min(attempts, INITIAL_UNITS)}.00`;
    const balance = await getBalance(wallet);
    const consistent = await isLedgerConsistent(wallet);
    check(
      `carteira ${wallet.id.slice(-8)}`,
      balance === expectedBalance && consistent,
      `saldo ${balance}, esperado ${expectedBalance}, ledger ${consistent ? 'bate' : 'diverge'}`,
    );
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} conferência(s) falharam.`);
    process.exit(1);
  }
  console.log('\nTudo certo.');
}

main().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  console.error(
    code === 'ECONNREFUSED'
      ? `Não consegui falar com a API em ${URLS.join(', ')}. Ela está no ar?`
      : error,
  );
  process.exit(1);
});
