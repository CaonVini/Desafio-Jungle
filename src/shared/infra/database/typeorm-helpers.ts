import { EntityManager, QueryFailedError } from "typeorm";
import { TransactionContext } from "../../domain/transaction-manager";

export function asManager(tx: TransactionContext): EntityManager {
  return tx as unknown as EntityManager;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = error.driverError as { code?: string; constraint?: string };
  if (driverError.code !== "23505") {
    return false;
  }
  return constraint === undefined || driverError.constraint === constraint;
}