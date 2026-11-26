export interface NewOutboxEvent {
  id: string;
  transactionId: string;
  eventType: string;
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

export interface OutboxStats {
  pending: number;
  oldestPendingAgeSeconds: number;
}
