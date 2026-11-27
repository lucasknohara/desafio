import {
  IntegrationEvent,
  IntegrationEventProps,
} from './integration-event.js';

interface MoneyPayload {
  amount: string;
  currency: string;
}

interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  type: string;
  amount: MoneyPayload;
  status: 'PROCESSED';
  balance: MoneyPayload;
}

export class WagerTransactionProcessedEvent extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  constructor(props: IntegrationEventProps<WagerTransactionProcessedData>) {
    super(props);
  }
}
