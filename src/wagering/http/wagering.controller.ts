import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { asObject } from "../../shared/http/payload-parser";
import {
  ProcessWagerTransactionResult,
  ProcessWagerTransactionUseCase,
} from "../application/process-wager-transaction.use-case";
import { parseWagerInput } from "../application/wager-input.parser";
import { WagerTransactionStatus } from "../domain/wager-transaction.enums";

function statusFor(status: string): number {
  if (status === WagerTransactionStatus.Processed) return 200;
  if (status === WagerTransactionStatus.PendingReference) return 202;
  return 422;
}

@Controller("wagering/transactions")
export class WageringController {
  constructor(private readonly processTransaction: ProcessWagerTransactionUseCase) {}

  @Post()
  async process(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcessWagerTransactionResult> {
    const result = await this.processTransaction.execute(
      parseWagerInput(asObject(body), idempotencyKey),
    );

    response.status(statusFor(result.transaction.status));
    return result;
  }
}
