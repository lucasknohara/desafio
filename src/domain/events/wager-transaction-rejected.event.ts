import {
  IntegrationEvent,
  IntegrationEventProps,
} from './integration-event.js';

interface MoneyPayload {
  amount: string;
  currency: string;
}

interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  failureCode: string;
  status: 'REJECTED';
  amount: MoneyPayload;
}

export class WagerTransactionRejectedEvent extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionRejectedData>) {
    super(props);
  }
}
