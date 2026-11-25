import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TransactionContext, TransactionManager } from "../../domain/transaction-manager";

@Injectable()
export class TypeOrmTransactionManager extends TransactionManager {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => work(manager as unknown as TransactionContext));
  }
}