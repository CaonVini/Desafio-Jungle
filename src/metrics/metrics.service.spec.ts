import { describe, expect, it } from "bun:test";
import { DomainError } from "../shared/domain/domain-error";
import { metricValue } from "../../test/support/metrics";
import { MetricsService } from "./metrics.service";

const NO_OUTBOX = { pending: 0, oldestPendingAgeSeconds: 0 };

describe("MetricsService", () => {
  it("comeca com todos os contadores em zero", () => {
    const text = new MetricsService().render(NO_OUTBOX);

    expect(metricValue(text, 'wager_transactions_total{status="PROCESSED"}')).toBe(0);
    expect(metricValue(text, 'wager_transactions_total{status="REJECTED"}')).toBe(0);
    expect(metricValue(text, 'wager_transactions_total{status="PENDING_REFERENCE"}')).toBe(0);
    expect(metricValue(text, "wager_duplicates_total")).toBe(0);
    expect(metricValue(text, "wager_dlq_messages_total")).toBe(0);
    expect(metricValue(text, "wager_lock_conflicts_total")).toBe(0);
    expect(metricValue(text, 'wager_retries_total{source="sqs"}')).toBe(0);
  });

  it("conta resultado por status e replay como duplicata, sem contar o status", () => {
    const metrics = new MetricsService();
    metrics.recordResult("PROCESSED", false, 10);
    metrics.recordResult("PROCESSED", false, 10);
    metrics.recordResult("REJECTED", false, 10);
    metrics.recordResult("PROCESSED", true, 10);

    const text = metrics.render(NO_OUTBOX);
    expect(metricValue(text, 'wager_transactions_total{status="PROCESSED"}')).toBe(2);
    expect(metricValue(text, 'wager_transactions_total{status="REJECTED"}')).toBe(1);
    expect(metricValue(text, "wager_duplicates_total")).toBe(1);
  });

  it("conta retries por origem e mensagens enviadas para a DLQ", () => {
    const metrics = new MetricsService();
    metrics.retryScheduled("sqs");
    metrics.retryScheduled("sqs");
    metrics.retryScheduled("outbox");
    metrics.messageSentToDlq();

    const text = metrics.render(NO_OUTBOX);
    expect(metricValue(text, 'wager_retries_total{source="sqs"}')).toBe(2);
    expect(metricValue(text, 'wager_retries_total{source="outbox"}')).toBe(1);
    expect(metricValue(text, 'wager_retries_total{source="pending_reference"}')).toBe(0);
    expect(metricValue(text, "wager_dlq_messages_total")).toBe(1);
  });

  it("so conta conflito de lock para WALLET_CONCURRENT_UPDATE", () => {
    const metrics = new MetricsService();
    metrics.failure(new DomainError("x", "WALLET_CONCURRENT_UPDATE"));
    metrics.failure(new DomainError("x", "IDEMPOTENCY_CONFLICT"));
    metrics.failure(new Error("outro"));

    expect(metricValue(metrics.render(NO_OUTBOX), "wager_lock_conflicts_total")).toBe(1);
  });

  it("histograma de latencia e cumulativo e fecha com +Inf igual ao total", () => {
    const metrics = new MetricsService();
    metrics.observeProcessing(3);
    metrics.observeProcessing(40);
    metrics.observeProcessing(5000);

    const text = metrics.render(NO_OUTBOX);
    expect(metricValue(text, 'wager_processing_duration_seconds_bucket{le="0.005"}')).toBe(1);
    expect(metricValue(text, 'wager_processing_duration_seconds_bucket{le="0.05"}')).toBe(2);
    expect(metricValue(text, 'wager_processing_duration_seconds_bucket{le="2.5"}')).toBe(2);
    expect(metricValue(text, 'wager_processing_duration_seconds_bucket{le="+Inf"}')).toBe(3);
    expect(metricValue(text, "wager_processing_duration_seconds_count")).toBe(3);
    expect(metricValue(text, "wager_processing_duration_seconds_sum")).toBeCloseTo(5.043, 3);
  });

  it("expoe o estado do outbox como gauge", () => {
    const text = new MetricsService().render({ pending: 4, oldestPendingAgeSeconds: 12.5 });

    expect(metricValue(text, "wager_outbox_pending_events")).toBe(4);
    expect(metricValue(text, "wager_outbox_lag_seconds")).toBe(12.5);
  });

  it("reset zera tudo", () => {
    const metrics = new MetricsService();
    metrics.recordResult("PROCESSED", false, 10);
    metrics.reset();

    const text = metrics.render(NO_OUTBOX);
    expect(metricValue(text, 'wager_transactions_total{status="PROCESSED"}')).toBe(0);
    expect(metricValue(text, "wager_processing_duration_seconds_count")).toBe(0);
  });
});
