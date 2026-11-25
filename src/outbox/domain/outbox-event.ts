export enum OutboxEventType {
  WagerTransactionProcessed = "wager.transaction.processed",
  WagerTransactionRejected = "wager.transaction.rejected",
}

export interface NewOutboxEvent {
  id: string;
  transactionId: string;
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface PendingOutboxEvent {
  id: string;
  transactionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}