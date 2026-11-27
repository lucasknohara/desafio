import { Module } from '@nestjs/common';
import { SqsService } from './sqs/sqs.service.js';
import { MetricsService } from './observability/metrics.service.js';
import { StructuredLogger } from './observability/structured-logger.service.js';
import { OutboxPublisherWorker } from './outbox/outbox-publisher.worker.js';

@Module({
  providers: [
    SqsService,
    MetricsService,
    StructuredLogger,
    OutboxPublisherWorker,
  ],
  exports: [SqsService, MetricsService, StructuredLogger],
})
export class InfrastructureModule {}
