import { v7 as uuidv7 } from "uuid";

export interface EventContext {
  correlationId: string;
  occurredAt: Date;
  causationId?: string;
}

export type SerializedIntegrationEvent<T> = {
  eventId: string;
  eventType: string;
  version: number;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  data: T;
};

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string = uuidv7();
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: T;

  protected constructor(aggregateId: string, data: T, context: EventContext) {
    this.aggregateId = aggregateId;
    this.data = data;
    this.correlationId = context.correlationId;
    this.causationId = context.causationId;
    this.occurredAt = context.occurredAt;
  }

  toJSON(): SerializedIntegrationEvent<T> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      data: this.data,
    };
  }
}
