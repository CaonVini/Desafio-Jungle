import { Controller, Get, Param } from "@nestjs/common";
import { readString } from "../../shared/http/payload-parser";
import { GetWagerTransactionUseCase } from "../application/get-wager-transaction.use-case";
import { WagerTransactionOutput } from "../application/wager-transaction.output";

@Controller("providers")
export class ProviderTransactionsController {
  constructor(private readonly getTransaction: GetWagerTransactionUseCase) {}

  @Get(":providerId/wagering/transactions/:externalTransactionId")
  get(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<WagerTransactionOutput> {
    return this.getTransaction.byProvider(
      readString({ providerId }, "providerId", 64),
      readString({ externalTransactionId }, "externalTransactionId", 128),
    );
  }
}
