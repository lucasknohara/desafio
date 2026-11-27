import { describe, expect, it } from 'bun:test';
import {
  IntegrationEvent,
  IntegrationEventProps,
} from './integration-event.js';

interface TestEventData {
  amount: {
    amount: string;
    currency: string;
  };
}

class TestEvent extends IntegrationEvent<TestEventData> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  constructor(props: IntegrationEventProps<TestEventData>) {
    super(props);
  }
}

describe('IntegrationEvent', () => {
  it('serializes a versioned event envelope', () => {
    const occurredAt = new Date('2026-11-27T12:00:00.000Z');
    const event = new TestEvent({
      eventId: 'event-1',
      aggregateId: 'wallet-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt,
      data: { amount: { amount: '10.00', currency: 'BRL' } },
    });

    expect(event.toJSON()).toEqual({
      eventId: 'event-1',
      eventType: 'TestEvent',
      aggregateId: 'wallet-1',
      correlationId: 'correlation-1',
      causationId: 'message-1',
      occurredAt: '2026-11-27T12:00:00.000Z',
      version: 1,
      data: { amount: { amount: '10.00', currency: 'BRL' } },
    });
  });

  it('does not serialize causationId when it is absent', () => {
    const event = new TestEvent({
      eventId: 'event-2',
      aggregateId: 'wallet-1',
      correlationId: 'correlation-1',
      occurredAt: new Date('2026-11-27T12:00:00.000Z'),
      data: { amount: { amount: '1.00', currency: 'BRL' } },
    });

    expect(event.toJSON()).not.toHaveProperty('causationId');
  });
});
