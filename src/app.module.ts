import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InboxModule } from "./inbox/inbox.module";
import { SqsConsumerWorker } from "./inbox/infra/sqs-consumer-worker";
import { OutboxWorker } from "./outbox/infra/outbox-worker";
import { OutboxModule } from "./outbox/outbox.module";
import { PersistenceModule } from "./persistence.module";
import { buildTypeOrmOptions } from "./shared/infra/database/typeorm.options";
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
    InboxModule,
    WalletModule,
    WageringModule,
  ],
  providers: [OutboxWorker, SqsConsumerWorker],
})
export class AppModule {}