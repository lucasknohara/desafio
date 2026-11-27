import { describe, expect, it } from 'bun:test';
import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('renders counters, labels, gauges and processing duration', () => {
    const metrics = new MetricsService();

    metrics.increment('wager_transactions_total', { status: 'PROCESSED' });
    metrics.increment('wager_transactions_total', { status: 'PROCESSED' });
    metrics.setGauge('outbox_pending_events', 3);
    metrics.observeProcessingMs(12);
    metrics.observeProcessingMs(8);

    expect(metrics.renderPrometheus()).toContain(
      'wager_transactions_total{status="PROCESSED"} 2',
    );
    expect(metrics.renderPrometheus()).toContain('outbox_pending_events 3');
    expect(metrics.renderPrometheus()).toContain(
      'wager_processing_duration_ms_count 2',
    );
    expect(metrics.renderPrometheus()).toContain(
      'wager_processing_duration_ms_sum 20',
    );
  });

  it('escapes label values in Prometheus output', () => {
    const metrics = new MetricsService();
    metrics.increment('wager_messages_total', { source: 'queue"\nworker' });

    expect(metrics.renderPrometheus()).toContain(
      'wager_messages_total{source="queue\\"\\nworker"} 1',
    );
  });
});
