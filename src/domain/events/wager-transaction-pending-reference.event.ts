import {
  IntegrationEvent,
  IntegrationEventProps,
} from './integration-event.js';

interface MoneyPayload {
  amount: string;
  currency: string;
}

interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  referenceExternalTransactionId: string | null;
  walletId: string;
  status: 'PENDING_REFERENCE';
  amount: MoneyPayload;
}

export class WagerTransactionPendingReferenceEvent extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  constructor(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ) {
    super(props);
  }
}
