import { describe, expect, it } from "bun:test";
import { EventContext, IntegrationEvent } from "./integration-event";

class SampleEvent extends IntegrationEvent<{ value: number }> {
  readonly eventType = "SampleEvent";
  readonly version = 3;

  static of(context: EventContext): SampleEvent {
    return new SampleEvent("aggregate-1", { value: 7 }, context);
  }
}

describe("IntegrationEvent", () => {
  const context = { correlationId: "corr-1", occurredAt: new Date("2026-01-02T03:04:05.678Z") };

  it("serializa o envelope com tipo e versao definidos pela subclasse", () => {
    const event = SampleEvent.of({ ...context, causationId: "cause-1" });

    expect(event.toJSON()).toEqual({
      eventId: event.eventId,
      eventType: "SampleEvent",
      version: 3,
      aggregateId: "aggregate-1",
      correlationId: "corr-1",
      causationId: "cause-1",
      occurredAt: "2026-01-02T03:04:05.678Z",
      data: { value: 7 },
    });
  });

  it("causationId e opcional e some do JSON quando ausente", () => {
    const serialized = JSON.parse(JSON.stringify(SampleEvent.of(context)));

    expect("causationId" in serialized).toBe(false);
  });

  it("cada evento tem um eventId proprio", () => {
    expect(SampleEvent.of(context).eventId).not.toBe(SampleEvent.of(context).eventId);
  });
});
