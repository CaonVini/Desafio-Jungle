import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ correlationId: string }>();

export function runWithCorrelationId<T>(correlationId: string, work: () => T): T {
  return storage.run({ correlationId }, work);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
