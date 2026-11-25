import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
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
    WalletModule,
    WageringModule,
  ],
})
export class AppModule {}