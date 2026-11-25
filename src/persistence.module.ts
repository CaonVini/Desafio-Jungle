import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OutboxRepository } from "./outbox/domain/outbox.repository";
import { OutboxEventOrmEntity } from "./outbox/infra/outbox-event.orm-entity";
import { TypeOrmOutboxRepository } from "./outbox/infra/typeorm-outbox.repository";
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
    TypeOrmModule.forFeature([
      WalletOrmEntity,
      WalletLedgerEntryOrmEntity,
      WagerTransactionOrmEntity,
      OutboxEventOrmEntity,
    ]),
  ],
  providers: [
    { provide: TransactionManager, useClass: TypeOrmTransactionManager },
    { provide: WalletRepository, useClass: TypeOrmWalletRepository },
    { provide: WagerTransactionRepository, useClass: TypeOrmWagerTransactionRepository },
    { provide: OutboxRepository, useClass: TypeOrmOutboxRepository },
  ],
  exports: [TransactionManager, WalletRepository, WagerTransactionRepository, OutboxRepository],
})
export class PersistenceModule {}