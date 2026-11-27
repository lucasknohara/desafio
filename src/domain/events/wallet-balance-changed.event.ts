import {
  IntegrationEvent,
  IntegrationEventProps,
} from './integration-event.js';

interface MoneyPayload {
  amount: string;
  currency: string;
}

interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  playerId: string;
  direction: 'CREDIT' | 'DEBIT';
  money: MoneyPayload;
  balanceBefore: MoneyPayload;
  balanceAfter: MoneyPayload;
  walletVersion: number;
}

export class WalletBalanceChangedEvent extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }
}
