import { Logger } from "@nestjs/common";
import type { WagerTransactionOutput } from "./wager-transaction.output";

export function logTransaction(
  logger: Logger,
  transaction: WagerTransactionOutput,
  extra: Record<string, unknown> = {},
): void {
  const fields = {
    message: `transaction.${transaction.status.toLowerCase()}`,
    transactionId: transaction.id,
    walletId: transaction.walletId,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    kind: transaction.kind,
    status: transaction.status,
    failureCode: transaction.failureCode,
    ...extra,
  };

  if (transaction.status === "REJECTED") {
    logger.warn(fields);
  } else {
    logger.log(fields);
  }
}
