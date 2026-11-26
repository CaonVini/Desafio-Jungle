export interface ReceivedEvent {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}