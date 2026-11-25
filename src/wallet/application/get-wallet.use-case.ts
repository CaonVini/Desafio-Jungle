import { Injectable } from "@nestjs/common";
import { DomainError } from "../../shared/domain/domain-error";
import { TransactionManager } from "../../shared/domain/transaction-manager";
import { WalletRepository } from "../domain/wallet.repository";
import { toWalletOutput, WalletOutput } from "./wallet.output";

@Injectable()
export class GetWalletUseCase {
  constructor(
    private readonly transactionManager: TransactionManager,
    private readonly wallets: WalletRepository,
  ) {}

  async execute(walletId: string): Promise<WalletOutput> {
    return this.transactionManager.run(async (tx) => {
      const wallet = await this.wallets.findById(tx, walletId);
      if (!wallet) {
        throw new DomainError("Wallet not found", "WALLET_NOT_FOUND");
      }
      return toWalletOutput(wallet);
    });
  }
}