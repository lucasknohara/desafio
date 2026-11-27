export type WagerStatus =
  'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';

export class WagerTransaction {
  private constructor(private currentStatus: WagerStatus) {}

  static create(): WagerTransaction {
    return new WagerTransaction('PENDING');
  }

  static rehydrate(status: WagerStatus): WagerTransaction {
    return new WagerTransaction(status);
  }

  get status(): WagerStatus {
    return this.currentStatus;
  }

  markPendingReference(): void {
    this.assertStatus('PENDING');
    this.currentStatus = 'PENDING_REFERENCE';
  }

  markProcessed(): void {
    this.assertPending();
    this.currentStatus = 'PROCESSED';
  }

  reject(): void {
    this.assertPending();
    this.currentStatus = 'REJECTED';
  }

  fail(): void {
    this.assertPending();
    this.currentStatus = 'FAILED';
  }

  isTerminal(): boolean {
    return ['PROCESSED', 'REJECTED', 'FAILED'].includes(this.currentStatus);
  }

  private assertPending(): void {
    if (
      this.currentStatus !== 'PENDING' &&
      this.currentStatus !== 'PENDING_REFERENCE'
    ) {
      throw new Error(`Cannot transition a ${this.currentStatus} transaction`);
    }
  }

  private assertStatus(expected: WagerStatus): void {
    if (this.currentStatus !== expected) {
      throw new Error(`Cannot transition a ${this.currentStatus} transaction`);
    }
  }
}
