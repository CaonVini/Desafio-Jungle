import { validate as isUuid } from "uuid";
import { DomainError } from "../domain/domain-error";
import { MoneyProps } from "../domain/money";

function invalidPayload(message: string): DomainError {
  return new DomainError(message, "INVALID_PAYLOAD");
}

export function asObject(value: unknown, field = "body"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPayload(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function readString(
  source: Record<string, unknown>,
  field: string,
  maxLength = 256,
): string {
  const value = source[field];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw invalidPayload(`${field} must be a non-empty string`);
  }
  return value;
}

export function readUuid(source: Record<string, unknown>, field: string): string {
  const value = readString(source, field, 36);
  if (!isUuid(value)) {
    throw invalidPayload(`${field} must be a UUID`);
  }
  return value;
}

export function readMoney(source: Record<string, unknown>, field: string): MoneyProps {
  const value = asObject(source[field], field);
  return {
    amount: readString(value, "amount", 32),
    currency: readString(value, "currency", 3),
  };
}