import { Module } from "@nestjs/common";
import { InboxModule } from "../inbox/inbox.module";
import { GetWagerTransactionUseCase } from "./application/get-wager-transaction.use-case";
import { PendingReferenceService } from "./application/pending-reference.service";
import { ProcessWagerTransactionUseCase } from "./application/process-wager-transaction.use-case";
import { WageringController } from "./http/wagering.controller";
import { ProviderTransactionsController } from "./http/provider-transactions.controller";
import { WagerTransactionConsumer } from "./messaging/wager-transaction-consumer";

@Module({
  imports: [InboxModule],
  controllers: [WageringController, ProviderTransactionsController],
  providers: [
    ProcessWagerTransactionUseCase,
    GetWagerTransactionUseCase,
    PendingReferenceService,
    WagerTransactionConsumer,
  ],
  exports: [ProcessWagerTransactionUseCase, PendingReferenceService, WagerTransactionConsumer],
})
export class WageringModule {}
