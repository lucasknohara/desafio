import { describe, expect, it } from 'bun:test';
import { WagerTransaction } from './wager-transaction.js';

describe('WagerTransaction', () => {
  it('starts in PENDING', () => {
    expect(WagerTransaction.create().status).toBe('PENDING');
  });

  it('allows a pending reference to finish or be rejected', () => {
    const processed = WagerTransaction.create();
    processed.markPendingReference();
    processed.markProcessed();

    const rejected = WagerTransaction.create();
    rejected.markPendingReference();
    rejected.reject();

    expect(processed.status).toBe('PROCESSED');
    expect(rejected.status).toBe('REJECTED');
  });

  it('does not allow transitions from terminal states', () => {
    const transaction = WagerTransaction.create();
    transaction.markProcessed();

    expect(transaction.isTerminal()).toBe(true);
    expect(() => transaction.reject()).toThrow(
      'Cannot transition a PROCESSED transaction',
    );
  });

  it('only allows PENDING to enter PENDING_REFERENCE', () => {
    const transaction = WagerTransaction.rehydrate('PENDING_REFERENCE');

    expect(() => transaction.markPendingReference()).toThrow(
      'Cannot transition a PENDING_REFERENCE transaction',
    );
  });
});
