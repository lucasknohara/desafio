import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { SqsService } from '../../infrastructure/sqs/sqs.service.js';

@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly sqs: SqsService,
  ) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    try {
      this.metrics.setGauge(
        'wager_dlq_messages',
        await this.sqs.getDlqApproximateCount(),
      );
    } catch {
      this.metrics.setGauge('wager_dlq_messages', -1);
    }
    return this.metrics.renderPrometheus();
  }
}
