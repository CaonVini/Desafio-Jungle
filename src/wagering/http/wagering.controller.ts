import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { DomainError } from "../../shared/domain/domain-error";
import {
  asObject,
  readMoney,
  readString,
  readUuid,
} from "../../shared/http/payload-parser";
import {
  ProcessWagerTransactionResult,
  ProcessWagerTransactionUseCase,
} from "../application/process-wager-transaction.use-case";
import { WagerTransactionKind, WagerTransactionStatus } from "../domain/wager-transaction.enums";

const ACCEPTED_KINDS = Object.values(WagerTransactionKind).filter(
  (kind) => kind !== WagerTransactionKind.Opening,
);

function readKind(source: Record<string, unknown>): WagerTransactionKind {
  const value = readString(source, "kind", 16);
  const kind = ACCEPTED_KINDS.find((accepted) => accepted === value);
  if (!kind) {
    throw new DomainError("kind is not supported", "INVALID_PAYLOAD");
  }
  return kind;
}

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
    const source = asObject(body);
    const referenceValue = source["referenceExternalTransactionId"];

    const result = await this.processTransaction.execute({
      providerId: readString(source, "providerId", 64),
      externalTransactionId: readString(source, "externalTransactionId", 128),
      idempotencyKey: readString({ "Idempotency-Key": idempotencyKey }, "Idempotency-Key", 128),
      walletId: readUuid(source, "walletId"),
      playerId: readUuid(source, "playerId"),
      roundId: readString(source, "roundId", 128),
      gameId: readString(source, "gameId", 128),
      kind: readKind(source),
      money: readMoney(source, "money"),
      referenceExternalTransactionId:
        referenceValue === undefined
          ? undefined
          : readString(source, "referenceExternalTransactionId", 128),
    });

    response.status(statusFor(result.transaction.status));
    return result;
  }
}