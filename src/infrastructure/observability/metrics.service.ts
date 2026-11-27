import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly durations: number[] = [];

  increment(name: string, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(this.key(name, {}), value);
  }

  observeProcessingMs(value: number): void {
    this.durations.push(value);
    if (this.durations.length > 1000) this.durations.shift();
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }

    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`);
    }

    if (this.durations.length > 0) {
      const sum = this.durations.reduce((total, value) => total + value, 0);
      lines.push(`wager_processing_duration_ms_count ${this.durations.length}`);
      lines.push(`wager_processing_duration_ms_sum ${sum}`);
    }

    return `${lines.join('\n')}\n`;
  }

  private key(name: string, labels: Record<string, string>): string {
    const metricName = name.replace(/[^a-zA-Z0-9_:]/g, '_');
    const entries = Object.entries(labels).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    if (entries.length === 0) return metricName;

    const labelSet = entries
      .map(([label, value]) => {
        const safeLabel = label.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeValue = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n');
        return `${safeLabel}="${safeValue}"`;
      })
      .join(',');

    return `${metricName}{${labelSet}}`;
  }
}
