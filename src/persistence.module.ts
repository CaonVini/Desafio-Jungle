import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TransactionManager } from "./shared/domain/transaction-manager";
import { TypeOrmTransactionManager } from "./shared/infra/database/typeorm-transaction-manager";
import { WagerTransactionRepository } from "./wagering/domain/wager-transaction.repository";
import { TypeOrmWagerTransactionRepository } from "./wagering/infra/typeorm-wager-transaction.repository";
import { WagerTransactionOrmEntity } from "./wagering/infra/wager-transaction.orm-entity";
import { WalletRepository } from "./wallet/domain/wallet.repository";
import { TypeOrmWalletRepository } from "./wallet/infra/typeorm-wallet.repository";
import { WalletLedgerEntryOrmEntity } from "./wallet/infra/wallet-ledger-entry.orm-entity";
import { WalletOrmEntity } from "./wallet/infra/wallet.orm-entity";

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([WalletOrmEntity, WalletLedgerEntryOrmEntity, WagerTransactionOrmEntity]),
  ],
  providers: [
    { provide: TransactionManager, useClass: TypeOrmTransactionManager },
    { provide: WalletRepository, useClass: TypeOrmWalletRepository },
    { provide: WagerTransactionRepository, useClass: TypeOrmWagerTransactionRepository },
  ],
  exports: [TransactionManager, WalletRepository, WagerTransactionRepository],
})
export class PersistenceModule {}