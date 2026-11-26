import { Injectable } from "@nestjs/common";
import { LessThanOrEqual } from "typeorm";
import { DomainError } from "../../shared/domain/domain-error";
import { TransactionContext } from "../../shared/domain/transaction-manager";
import { asManager, isUniqueViolation } from "../../shared/infra/database/typeorm-helpers";
import { WagerTransaction } from "../domain/wager-transaction";
import { WagerTransactionKind, WagerTransactionStatus } from "../domain/wager-transaction.enums";
import { WagerTransactionRepository } from "../domain/wager-transaction.repository";
import { WagerTransactionMapper } from "./wager-transaction.mapper";
import { WagerTransactionOrmEntity } from "./wager-transaction.orm-entity";

@Injectable()
export class TypeOrmWagerTransactionRepository extends WagerTransactionRepository {
  async insertIfAbsent(tx: TransactionContext, transaction: WagerTransaction): Promise<boolean> {
    const result = await asManager(tx)
      .createQueryBuilder()
      .insert()
      .into(WagerTransactionOrmEntity)
      .values(WagerTransactionMapper.toOrm(transaction))
      .orIgnore()
      .returning("id")
      .execute();
    return result.raw.length > 0;
  }

  async findById(tx: TransactionContext, id: string): Promise<WagerTransaction | undefined> {
    const entity = await asManager(tx).findOne(WagerTransactionOrmEntity, { where: { id } });
    return entity ? WagerTransactionMapper.toDomain(entity) : undefined;
  }

  async findByProviderAndExternalId(
    tx: TransactionContext,
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | undefined> {
    const entity = await asManager(tx).findOne(WagerTransactionOrmEntity, {
      where: { providerId, externalTransactionId },
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : undefined;
  }

  async findByProviderAndIdempotencyKey(
    tx: TransactionContext,
    providerId: string,
    idempotencyKey: string,
  ): Promise<WagerTransaction | undefined> {
    const entity = await asManager(tx).findOne(WagerTransactionOrmEntity, {
      where: { providerId, idempotencyKey },
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : undefined;
  }

  async update(tx: TransactionContext, transaction: WagerTransaction): Promise<void> {
    try {
      await asManager(tx).update(
        WagerTransactionOrmEntity,
        { id: transaction.id },
        {
          status: transaction.status,
          referenceTransactionId: transaction.referenceTransactionId ?? null,
          failureCode: transaction.failureCode ?? null,
          referenceAttempts: transaction.referenceAttempts,
          nextAttemptAt: transaction.nextAttemptAt ?? null,
          balanceAfter: transaction.balanceAfter?.toString() ?? null,
          processedAt: transaction.processedAt ?? null,
        },
      );
    } catch (error) {
      if (isUniqueViolation(error, "uq_wager_transactions_single_reversal")) {
        throw new DomainError("Reference was already reverted", "ALREADY_REVERSED");
      }
      throw error;
    }
  }

  async findDuePendingReference(
    tx: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<WagerTransaction[]> {
    const entities = await asManager(tx).find(WagerTransactionOrmEntity, {
      where: {
        status: WagerTransactionStatus.PendingReference,
        nextAttemptAt: LessThanOrEqual(now),
      },
      order: { nextAttemptAt: "ASC" },
      take: limit,
    });
    return entities.map((entity) => WagerTransactionMapper.toDomain(entity));
  }

  async hasProcessedReversal(
    tx: TransactionContext,
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean> {
    const count = await asManager(tx).count(WagerTransactionOrmEntity, {
      where: { referenceTransactionId, kind, status: WagerTransactionStatus.Processed },
    });
    return count > 0;
  }
}
