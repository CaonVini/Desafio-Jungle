import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HealthModule } from "./health/health.module";
import { MetricsModule } from "./metrics/metrics.module";
import { OutboxWorker } from "./outbox/infra/outbox-worker";
import { OutboxModule } from "./outbox/outbox.module";
import { PersistenceModule } from "./persistence.module";
import { AuthGuard } from "./shared/http/auth.guard";
import { buildTypeOrmOptions } from "./shared/infra/database/typeorm.options";
import { PendingReferenceWorker } from "./wagering/infra/pending-reference-worker";
import { SqsTransactionWorker } from "./wagering/messaging/sqs-transaction-worker";
import { WageringModule } from "./wagering/wagering.module";
import { WalletModule } from "./wallet/wallet.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildTypeOrmOptions(),
        entities: [],
        migrations: [],
        autoLoadEntities: true,
      }),
    }),
    PersistenceModule,
    OutboxModule,
    WalletModule,
    WageringModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    OutboxWorker,
    SqsTransactionWorker,
    PendingReferenceWorker,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
