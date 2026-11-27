export class Money {
  private static readonly MAX_MINOR_UNITS = 99_999_999_999_999_999_999n;

  private constructor(
    private readonly minorUnits: bigint,
    readonly currency: string,
  ) {}

  static fromDecimal(amount: string, currency: string): Money {
    if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('Invalid currency');
    }

    if (
      typeof amount !== 'string' ||
      !/^\d{1,18}(?:\.\d{1,2})?$/.test(amount)
    ) {
      throw new Error('Invalid amount');
    }

    const [integerPart, decimalPart = ''] = amount.split('.');
    const minorUnits = BigInt(`${integerPart}${decimalPart.padEnd(2, '0')}`);

    if (minorUnits > Money.MAX_MINOR_UNITS) {
      throw new RangeError('Money amount exceeds supported precision');
    }

    return new Money(minorUnits, currency);
  }

  static zero(currency: string): Money {
    return Money.fromDecimal('0.00', currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.fromMinorUnits(
      this.minorUnits + other.minorUnits,
      this.currency,
    );
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.minorUnits - other.minorUnits;

    if (result < 0n) {
      throw new RangeError('Money amount cannot be negative');
    }

    return Money.fromMinorUnits(result, this.currency);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);

    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency && this.minorUnits === other.minorUnits
    );
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  toMinorUnits(): bigint {
    return this.minorUnits;
  }

  toDecimal(): string {
    const normalized = this.minorUnits.toString().padStart(3, '0');
    return `${normalized.slice(0, -2)}.${normalized.slice(-2)}`;
  }

  private static fromMinorUnits(minorUnits: bigint, currency: string): Money {
    if (minorUnits < 0n || minorUnits > Money.MAX_MINOR_UNITS) {
      throw new RangeError('Money amount exceeds supported precision');
    }

    return new Money(minorUnits, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} != ${other.currency}`,
      );
    }
  }
}
