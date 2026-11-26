import { TransactionContext } from "../../shared/domain/transaction-manager";

export interface InboxEntry {
  consumerName: string;
  messageId: string;
  messageType: string;
  receivedAt: Date;
}

export abstract class InboxRepository {
  abstract registerIfAbsent(tx: TransactionContext, entry: InboxEntry): Promise<boolean>;
}
