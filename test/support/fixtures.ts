import { ProcessWagerTransactionInput } from "../../src/wagering/application/process-wager-transaction.use-case";
import { WagerTransactionKind } from "../../src/wagering/domain/wager-transaction.enums";

let sequence = 0;

export function transactionInput(
  wallet: { id: string; playerId: string },
  overrides: Partial<ProcessWagerTransactionInput> = {},
): ProcessWagerTransactionInput {
  sequence += 1;
  return {
    providerId: "provider-a",
    externalTransactionId: `tx-${sequence}`,
    idempotencyKey: `key-${sequence}`,
    walletId: wallet.id,
    playerId: wallet.playerId,
    roundId: "round-1",
    gameId: "game-1",
    kind: WagerTransactionKind.Bet,
    money: { amount: "25.00", currency: "BRL" },
    ...overrides,
  };
}