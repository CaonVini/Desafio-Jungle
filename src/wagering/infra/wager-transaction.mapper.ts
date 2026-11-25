import { Money } from "../../shared/domain/money";
import {
  FailureCode,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../domain/wager-transaction.enums";
import { WagerTransaction } from "../domain/wager-transaction";
import { WagerTransactionOrmEntity } from "./wager-transaction.orm-entity";

export class WagerTransactionMapper {
  static toDomain(entity: WagerTransactionOrmEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: Money.from({ amount: entity.amount, currency: entity.currency }),
      referenceExternalTransactionId: entity.referenceExternalTransactionId ?? undefined,
      createdAt: entity.createdAt,
      status: entity.status as WagerTransactionStatus,
      referenceTransactionId: entity.referenceTransactionId ?? undefined,
      failureCode: (entity.failureCode ?? undefined) as FailureCode | undefined,
      processedAt: entity.processedAt ?? undefined,
      referenceAttempts: entity.referenceAttempts,
      nextAttemptAt: entity.nextAttemptAt ?? undefined,
    });
  }

  static toOrm(transaction: WagerTransaction): WagerTransactionOrmEntity {
    const entity = new WagerTransactionOrmEntity();
    entity.id = transaction.id;
    entity.providerId = transaction.providerId;
    entity.externalTransactionId = transaction.externalTransactionId;
    entity.idempotencyKey = transaction.idempotencyKey;
    entity.payloadHash = transaction.payloadHash;
    entity.walletId = transaction.walletId;
    entity.playerId = transaction.playerId;
    entity.roundId = transaction.roundId;
    entity.gameId = transaction.gameId;
    entity.kind = transaction.kind;
    entity.amount = transaction.money.toString();
    entity.currency = transaction.money.currency;
    entity.referenceExternalTransactionId = transaction.referenceExternalTransactionId ?? null;
    entity.referenceTransactionId = transaction.referenceTransactionId ?? null;
    entity.status = transaction.status;
    entity.failureCode = transaction.failureCode ?? null;
    entity.referenceAttempts = transaction.referenceAttempts;
    entity.nextAttemptAt = transaction.nextAttemptAt ?? null;
    entity.createdAt = transaction.createdAt;
    entity.processedAt = transaction.processedAt ?? null;
    return entity;
  }
}