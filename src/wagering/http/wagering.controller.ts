import { Body, Controller, Get, Headers, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { asObject, readUuid } from "../../shared/http/payload-parser";
import { GetWagerTransactionUseCase } from "../application/get-wager-transaction.use-case";
import { ProcessWagerTransactionUseCase } from "../application/process-wager-transaction.use-case";
import { parseWagerInput } from "../application/wager-input.parser";
import {
  ProcessTransactionResponse,
  toProcessResponse,
  WagerTransactionOutput,
} from "../application/wager-transaction.output";
import { WagerTransactionStatus } from "../domain/wager-transaction.enums";

function statusFor(status: string): number {
  if (status === WagerTransactionStatus.Processed) return 200;
  if (status === WagerTransactionStatus.PendingReference) return 202;
  return 422;
}

@Controller("wagering/transactions")
export class WageringController {
  constructor(
    private readonly processTransaction: ProcessWagerTransactionUseCase,
    private readonly getTransaction: GetWagerTransactionUseCase,
  ) {}

  @Post()
  async process(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcessTransactionResponse> {
    const result = await this.processTransaction.execute(
      parseWagerInput(asObject(body), idempotencyKey),
    );

    response.status(statusFor(result.transaction.status));
    return toProcessResponse(result.transaction, result.idempotentReplay);
  }

  @Get(":transactionId")
  get(@Param("transactionId") transactionId: string): Promise<WagerTransactionOutput> {
    return this.getTransaction.byId(readUuid({ transactionId }, "transactionId"));
  }
}
