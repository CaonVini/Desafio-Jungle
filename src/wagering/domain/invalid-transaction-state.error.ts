import { DomainError } from "../../shared/domain/domain-error";
import { WagerTransactionStatus } from "./transaction.enums";

export class InvalidTransactionStateError extends DomainError {
  constructor(transactionId: string, status: WagerTransactionStatus, action: string) {
    super(
      `Transaction ${transactionId} in status ${status} cannot ${action}`,
      "INVALID_TRANSACTION_STATE",
    );
  }
}
