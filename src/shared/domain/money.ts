import Decimal from "decimal.js";
import { DomainError } from "./domain-error";

export interface MoneyProps {
  amount: string;  
  currency: string; 
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}


  static from(props: MoneyProps): Money {
    if (!/^\d+(\.\d{1,2})?$/.test(props.amount)) {
      throw new DomainError("Invalid amount format", "INVALID_AMOUNT");
    }
    if (!/^[A-Z]{3}$/.test(props.currency)) {
      throw new DomainError("Invalid currency format", "INVALID_CURRENCY");
    }
    return new Money(new Decimal(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    return Money.from({ amount: "0.00", currency });
  }


  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.neg(), this.currency);
  }


  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.gt(0);
  }

  isNegative(): boolean {
    return this.value.lt(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lt(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }


  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency };
  }

  toString(): string {
    return this.value.toFixed(2);
  }


  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError("Currency mismatch", "CURRENCY_MISMATCH");
    }
  }
}