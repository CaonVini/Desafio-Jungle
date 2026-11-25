export interface OutboundMessage {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}

export abstract class MessagePublisher {
  abstract publish(message: OutboundMessage): Promise<void>;
}