import { Money } from '../money/money.js';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  currency: string;
  initialBalance: Money;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
}

export class Wallet {
  private constructor(
    readonly id: string,
    readonly playerId: string,
    readonly currency: string,
    private currentBalance: Money,
    private currentVersion: number,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.currency !== props.currency) {
      throw new Error('Currency mismatch');
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.currency,
      props.initialBalance,
      1,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    if (!Number.isSafeInteger(state.version) || state.version < 1) {
      throw new Error('Invalid wallet version');
    }

    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.fromDecimal(state.balance, state.currency),
      state.version,
    );
  }

  get balance(): Money {
    return this.currentBalance;
  }

  get version(): number {
    return this.currentVersion;
  }

  hasFunds(amount: Money): boolean {
    return this.currentBalance.compare(amount) >= 0;
  }

  debit(amount: Money): void {
    this.assertPositiveAmount(amount);

    if (!this.hasFunds(amount)) {
      throw new RangeError('Insufficient funds');
    }

    this.currentBalance = this.currentBalance.subtract(amount);
    this.currentVersion += 1;
  }

  credit(amount: Money): void {
    this.assertPositiveAmount(amount);
    this.currentBalance = this.currentBalance.add(amount);
    this.currentVersion += 1;
  }

  private assertPositiveAmount(amount: Money): void {
    if (!amount.isPositive()) {
      throw new RangeError('Wallet movements must be positive');
    }
  }
}
