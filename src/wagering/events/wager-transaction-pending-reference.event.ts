import { EventContext, IntegrationEvent } from "../../outbox/domain/integration-event";
import {
  WagerTransactionOutput,
  toWagerTransactionOutput,
} from "../application/wager-transaction.output";
import { WagerTransaction } from "../domain/wager-transaction";

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionOutput> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference(
      transaction.id,
      toWagerTransactionOutput(transaction),
      context,
    );
  }
}
