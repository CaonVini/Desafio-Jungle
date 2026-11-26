import { MoneyProps } from "../../shared/domain/money";
import { WagerTransaction } from "../domain/wager-transaction";

export interface WagerTransactionOutput {
  id: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  amount: MoneyProps;
  status: string;
  balance?: MoneyProps;
  failureCode?: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  processedAt?: string;
  nextAttemptAt?: string;
}

export function toWagerTransactionOutput(transaction: WagerTransaction): WagerTransactionOutput {
  return {
    id: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    amount: transaction.money.toJSON(),
    status: transaction.status,
    balance: transaction.balanceAfter?.toJSON(),
    failureCode: transaction.failureCode,
    referenceExternalTransactionId: transaction.referenceExternalTransactionId,
    referenceTransactionId: transaction.referenceTransactionId,
    processedAt: transaction.processedAt?.toISOString(),
    nextAttemptAt: transaction.nextAttemptAt?.toISOString(),
  };
}
export interface ProcessTransactionResponse {
  transactionId: string;
  status: string;
  balance?: MoneyProps;
  failureCode?: string;
  idempotentReplay: boolean;
  transaction: WagerTransactionOutput;
}

export function toProcessResponse(
  transaction: WagerTransactionOutput,
  idempotentReplay: boolean,
): ProcessTransactionResponse {
  return {
    transactionId: transaction.id,
    status: transaction.status,
    balance: transaction.balance,
    failureCode: transaction.failureCode,
    idempotentReplay,
    transaction,
  };
}
