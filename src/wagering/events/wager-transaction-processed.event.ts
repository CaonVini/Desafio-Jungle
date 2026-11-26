import { EventContext, IntegrationEvent } from "../../outbox/domain/integration-event";
import {
  WagerTransactionOutput,
  toWagerTransactionOutput,
} from "../application/wager-transaction.output";
import { WagerTransaction } from "../domain/wager-transaction";

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionOutput> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionProcessed {
    return new WagerTransactionProcessed(
      transaction.id,
      toWagerTransactionOutput(transaction),
      context,
    );
  }
}
