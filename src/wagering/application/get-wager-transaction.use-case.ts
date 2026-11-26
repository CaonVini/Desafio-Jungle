import { Injectable } from "@nestjs/common";
import { DomainError } from "../../shared/domain/domain-error";
import { TransactionContext, TransactionManager } from "../../shared/domain/transaction-manager";
import { WagerTransaction } from "../domain/wager-transaction";
import { WagerTransactionRepository } from "../domain/wager-transaction.repository";
import { toWagerTransactionOutput, WagerTransactionOutput } from "./wager-transaction.output";

@Injectable()
export class GetWagerTransactionUseCase {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly transactions: WagerTransactionRepository,
  ) {}

  byId(id: string): Promise<WagerTransactionOutput> {
    return this.find((tx) => this.transactions.findById(tx, id));
  }

  byProvider(providerId: string, externalTransactionId: string): Promise<WagerTransactionOutput> {
    return this.find((tx) =>
      this.transactions.findByProviderAndExternalId(tx, providerId, externalTransactionId),
    );
  }

  private async find(
    lookup: (tx: TransactionContext) => Promise<WagerTransaction | undefined>,
  ): Promise<WagerTransactionOutput> {
    const transaction = await this.transactionManager.run(lookup);
    if (!transaction) {
      throw new DomainError("Transaction not found", "TRANSACTION_NOT_FOUND");
    }
    return toWagerTransactionOutput(transaction);
  }
}
