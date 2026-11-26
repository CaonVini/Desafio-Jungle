import { Injectable, Logger } from "@nestjs/common";
import { MetricsService } from "../../metrics/metrics.service";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { runWithCorrelationId } from "../../shared/logging/correlation";
import { WagerTransactionRepository } from "../domain/wager-transaction.repository";
import { ProcessWagerTransactionUseCase } from "./process-wager-transaction.use-case";
import { logTransaction } from "./transaction-log";

export const PENDING_REFERENCE_BATCH_SIZE = 20;

export interface RetryBatchResult {
  checked: number;
  processed: number;
  rejected: number;
  stillPending: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class PendingReferenceService {
  private readonly logger = new Logger(PendingReferenceService.name);

  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly transactions: WagerTransactionRepository,
    private readonly processTransaction: ProcessWagerTransactionUseCase,
    private readonly metrics: MetricsService,
  ) {}

  async retryDue(
    now: Date = new Date(),
    limit: number = PENDING_REFERENCE_BATCH_SIZE,
  ): Promise<RetryBatchResult> {
    const due = await this.transactionManager.run((tx) =>
      this.transactions.findDuePendingReference(tx, now, limit),
    );

    const result: RetryBatchResult = {
      checked: due.length,
      processed: 0,
      rejected: 0,
      stillPending: 0,
      skipped: 0,
      failed: 0,
    };

    for (const pending of due) {
      await runWithCorrelationId(pending.id, async () => {
        try {
          const updated = await this.processTransaction.retryPendingReference(pending.id, now);
          if (!updated) {
            result.skipped++;
            return;
          }
          if (updated.status === "PROCESSED") result.processed++;
          else if (updated.status === "REJECTED") result.rejected++;
          else result.stillPending++;
          if (updated.status === "PENDING_REFERENCE") {
            this.metrics.retryScheduled("pending_reference");
          } else {
            this.metrics.transactionFinished(updated.status);
          }
          logTransaction(this.logger, updated, { source: "pending_reference_retry" });
        } catch (error) {
          result.failed++;
          this.logger.error({
            message: "pending_reference.retry_failed",
            transactionId: pending.id,
            walletId: pending.walletId,
            providerId: pending.providerId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    return result;
  }
}
