import { DomainError } from "../../shared/domain/domain-error";

export class InsufficientFundsError extends DomainError {
  constructor() {
    super("Insufficient funds", "INSUFFICIENT_FUNDS");
  }
}