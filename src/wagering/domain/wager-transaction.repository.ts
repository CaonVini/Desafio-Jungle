import { TransactionContext } from "../../shared/domain/transaction-manager";
import { WagerTransaction } from "./wager-transaction";
import { WagerTransactionKind } from "./wager-transaction.enums";

export abstract class WagerTransactionRepository {
  abstract insertIfAbsent(tx: TransactionContext, transaction: WagerTransaction): Promise<boolean>;

  abstract findById(tx: TransactionContext, id: string): Promise<WagerTransaction | undefined>;

  abstract findByProviderAndExternalId(
    tx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined>;

  abstract findByProviderAndIdempotencyKey(
    tx: TransactionContext,
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined>;

  abstract update(tx: TransactionContext, transaction: WagerTransaction): Promise<void>;

  abstract findDuePendingReference(
    tx: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<WagerTransaction[]>;

  abstract hasProcessedReversal(
    tx: TransactionContext,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean>;
}