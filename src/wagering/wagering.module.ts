import { Module } from "@nestjs/common";
import { InboxModule } from "../inbox/inbox.module";
import { ProcessWagerTransactionUseCase } from "./application/process-wager-transaction.use-case";
import { WageringController } from "./http/wagering.controller";
import { WagerTransactionConsumer } from "./messaging/wager-transaction-consumer";

@Module({
  imports: [InboxModule],
  controllers: [WageringController],
  providers: [ProcessWagerTransactionUseCase, WagerTransactionConsumer],
  exports: [ProcessWagerTransactionUseCase, WagerTransactionConsumer],
})
export class WageringModule {}
