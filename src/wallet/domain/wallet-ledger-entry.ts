import { DomainError } from "../../shared/domain/domain-error";
import { Money } from "../../shared/domain/money";
import { LedgerDirection } from "./ledger-direction";

export interface WalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(private readonly props: WalletLedgerEntryProps) {}

  static create(props: WalletLedgerEntryProps): WalletLedgerEntry {
    if (!props.money.isPositive()) {
      throw new DomainError("Ledger entry amount must be positive", "NON_POSITIVE_AMOUNT");
    }
    const entry = new WalletLedgerEntry(props);
    if (!entry.isBalanced()) {
      throw new DomainError("Ledger entry does not balance", "UNBALANCED_LEDGER_ENTRY");
    }
    return entry;
  }

  isBalanced(): boolean {
    const { direction, money, balanceBefore, balanceAfter } = this.props;
    const expected =
      direction === LedgerDirection.DEBIT
        ? balanceBefore.subtract(money)
        : balanceBefore.add(money);
    return expected.equals(balanceAfter);
  }

  static rehydrate(props: WalletLedgerEntryProps): WalletLedgerEntry {
    return new WalletLedgerEntry(props);
  }

  get id(): string {
    return this.props.id;
  }

  get walletId(): string {
    return this.props.walletId;
  }

  get transactionId(): string {
    return this.props.transactionId;
  }

  get direction(): LedgerDirection {
    return this.props.direction;
  }

  get money(): Money {
    return this.props.money;
  }

  get balanceBefore(): Money {
    return this.props.balanceBefore;
  }

  get balanceAfter(): Money {
    return this.props.balanceAfter;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
