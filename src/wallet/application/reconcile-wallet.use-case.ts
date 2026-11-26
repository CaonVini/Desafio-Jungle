import { Injectable, Logger } from "@nestjs/common";
import { DomainError } from "../../shared/domain/domain-error";
import { MoneyProps } from "../../shared/domain/money";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { WalletRepository } from "../domain/wallet.repository";

export interface ReconciliationOutput {
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class ReconcileWalletUseCase {
  private readonly logger = new Logger(ReconcileWalletUseCase.name);

  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly wallets: WalletRepository,
  ) {}

  async execute(walletId: string): Promise<ReconciliationOutput> {
    const totals = await this.transactionManager.run((tx) =>
      this.wallets.ledgerTotals(tx, walletId),
    );
    if (!totals) {
      throw new DomainError("Wallet not found", "WALLET_NOT_FOUND");
    }

    const { currency } = totals;
    const consistent = totals.difference === "0.00";

    if (!consistent) {
      this.logger.error({
        message: "reconciliation.divergence",
        walletId,
        difference: totals.difference,
        checkedEntries: totals.checkedEntries,
      });
    }

    return {
      storedBalance: { amount: totals.storedBalance, currency },
      calculatedBalance: { amount: totals.calculatedBalance, currency },
      difference: { amount: totals.difference, currency },
      consistent,
      checkedEntries: totals.checkedEntries,
    };
  }
}
