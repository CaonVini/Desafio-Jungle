import { Injectable } from "@nestjs/common";
import { DataSource, QueryFailedError } from "typeorm";
import { DatabaseBusyError } from "../../domain/database-busy.error";
import { TransactionContext, TransactionManager } from "../../domain/transaction-manager";

const BUSY_SQLSTATES = new Set([
  "55P03", // lock_timeout
  "57014", // statement_timeout
  "40P01", // deadlock detectado
  "40001", // falha de serializacao
]);

@Injectable()
export class TypeOrmTransactionManager extends TransactionManager {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction((manager) =>
        work(manager as unknown as TransactionContext),
      );
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const code = (error.driverError as { code?: string } | undefined)?.code;
        if (code && BUSY_SQLSTATES.has(code)) {
          throw new DatabaseBusyError(`database busy (${code})`, error);
        }
      }
      throw error;
    }
  }
}
