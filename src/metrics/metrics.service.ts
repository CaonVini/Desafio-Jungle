import { Injectable } from "@nestjs/common";
import { DatabaseBusyError } from "../shared/domain/database-busy.error";
import { DomainError } from "../shared/domain/domain-error";
import type { OutboxStats } from "../outbox/domain/outbox-event";

export type RetrySource = "sqs" | "pending_reference" | "outbox";

const LATENCY_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

const TRANSACTIONS = "wager_transactions_total";
const DUPLICATES = "wager_duplicates_total";
const RETRIES = "wager_retries_total";
const DLQ = "wager_dlq_messages_total";
const LOCK_CONFLICTS = "wager_lock_conflicts_total";
const OUTBOX_PUBLISHED = "wager_outbox_published_total";

const COUNTER_HELP: Record<string, string> = {
  [TRANSACTIONS]: "Transacoes por status final ou pendente",
  [DUPLICATES]: "Requisicoes e mensagens duplicadas detectadas",
  [RETRIES]: "Tentativas repetidas por origem",
  [DLQ]: "Mensagens enviadas para a DLQ pela aplicacao",
  [LOCK_CONFLICTS]: "Conflitos de concorrencia na carteira",
  [OUTBOX_PUBLISHED]: "Eventos do outbox publicados",
};

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly latencyBuckets = Array.from({ length: LATENCY_BUCKETS_SECONDS.length }, () => 0);
  private latencyCount = 0;
  private latencySum = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.counters.clear();
    this.latencyBuckets.fill(0);
    this.latencyCount = 0;
    this.latencySum = 0;
    for (const status of ["PROCESSED", "REJECTED", "PENDING_REFERENCE"]) {
      this.add(TRANSACTIONS, { status }, 0);
    }
    for (const source of ["sqs", "pending_reference", "outbox"]) {
      this.add(RETRIES, { source }, 0);
    }
    this.add(DUPLICATES, {}, 0);
    this.add(DLQ, {}, 0);
    this.add(LOCK_CONFLICTS, {}, 0);
    this.add(OUTBOX_PUBLISHED, {}, 0);
  }

  recordResult(status: string, idempotentReplay: boolean, durationMs: number): void {
    if (idempotentReplay) {
      this.duplicateDetected();
    } else {
      this.transactionFinished(status);
    }
    this.observeProcessing(durationMs);
  }

  transactionFinished(status: string): void {
    this.add(TRANSACTIONS, { status }, 1);
  }

  duplicateDetected(): void {
    this.add(DUPLICATES, {}, 1);
  }

  retryScheduled(source: RetrySource): void {
    this.add(RETRIES, { source }, 1);
  }

  messageSentToDlq(): void {
    this.add(DLQ, {}, 1);
  }

  outboxPublished(): void {
    this.add(OUTBOX_PUBLISHED, {}, 1);
  }

  failure(error: unknown): void {
    if (
      error instanceof DatabaseBusyError ||
      (error instanceof DomainError && error.code === "WALLET_CONCURRENT_UPDATE")
    ) {
      this.add(LOCK_CONFLICTS, {}, 1);
    }
  }

  observeProcessing(durationMs: number): void {
    const seconds = durationMs / 1000;
    this.latencyCount++;
    this.latencySum += seconds;
    LATENCY_BUCKETS_SECONDS.forEach((limit, index) => {
      if (seconds <= limit) {
        this.latencyBuckets[index]++;
      }
    });
  }

  render(outbox: OutboxStats): string {
    const lines: string[] = [];
    const names = [...new Set([...this.counters.keys()].map((key) => key.split("{")[0] ?? key))];
    for (const name of names) {
      lines.push(`# HELP ${name} ${COUNTER_HELP[name] ?? name}`, `# TYPE ${name} counter`);
      for (const [key, value] of this.counters) {
        if (key === name || key.startsWith(`${name}{`)) {
          lines.push(`${key} ${value}`);
        }
      }
    }

    lines.push(
      "# HELP wager_outbox_pending_events Eventos do outbox ainda nao publicados",
      "# TYPE wager_outbox_pending_events gauge",
      `wager_outbox_pending_events ${outbox.pending}`,
      "# HELP wager_outbox_lag_seconds Idade do evento pendente mais antigo do outbox",
      "# TYPE wager_outbox_lag_seconds gauge",
      `wager_outbox_lag_seconds ${outbox.oldestPendingAgeSeconds}`,
      "# HELP wager_processing_duration_seconds Latencia de processamento de transacoes",
      "# TYPE wager_processing_duration_seconds histogram",
    );
    LATENCY_BUCKETS_SECONDS.forEach((limit, index) => {
      lines.push(
        `wager_processing_duration_seconds_bucket{le="${limit}"} ${this.latencyBuckets[index]}`,
      );
    });
    lines.push(
      `wager_processing_duration_seconds_bucket{le="+Inf"} ${this.latencyCount}`,
      `wager_processing_duration_seconds_sum ${this.latencySum}`,
      `wager_processing_duration_seconds_count ${this.latencyCount}`,
    );
    return `${lines.join("\n")}\n`;
  }

  private add(name: string, labels: Record<string, string>, amount: number): void {
    const pairs = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
    const key = pairs.length > 0 ? `${name}{${pairs.join(",")}}` : name;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }
}
