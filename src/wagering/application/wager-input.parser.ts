import { DomainError } from "../../shared/domain/domain-error";
import { readMoney, readString, readUuid } from "../../shared/http/payload-parser";
import { WagerTransactionKind } from "../domain/wager-transaction.enums";
import { ProcessWagerTransactionInput } from "./process-wager-transaction.use-case";

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

export function parseWagerInput(
  source: Record<string, unknown>,
  idempotencyKey: string | undefined,
): ProcessWagerTransactionInput {
  const referenceValue = source["referenceExternalTransactionId"];

  return {
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
  };
}
