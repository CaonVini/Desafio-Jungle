import { EventContext, IntegrationEvent } from "../../outbox/domain/integration-event";
import {
  WagerTransactionOutput,
  toWagerTransactionOutput,
} from "../application/wager-transaction.output";
import { WagerTransaction } from "../domain/wager-transaction";

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionOutput> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionRejected {
    return new WagerTransactionRejected(
      transaction.id,
      toWagerTransactionOutput(transaction),
      context,
    );
  }
}
