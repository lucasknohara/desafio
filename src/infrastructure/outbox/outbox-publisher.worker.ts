import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { OutboxEventEntity } from '../../database/entities/outbox-event.entity.js';
import { SqsService } from '../sqs/sqs.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';

@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeBatch: Promise<void> | null = null;

  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    if (!this.sqs.enabled) return;

    this.timer = setInterval(() => {
      if (!this.activeBatch) {
        this.activeBatch = this.publishBatch().finally(() => {
          this.activeBatch = null;
        });
      }
    }, 2000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.activeBatch;
  }

  private async publishBatch(): Promise<void> {
    try {
      const em = this.em.fork();
      const pendingCount = await em.count(OutboxEventEntity, {
        status: { $ne: 'PUBLISHED' },
      });
      const oldestPending = await em.findOne(
        OutboxEventEntity,
        { status: { $ne: 'PUBLISHED' } },
        { orderBy: { createdAt: 'ASC' } },
      );
      this.metrics.setGauge('outbox_pending_events', pendingCount);
      this.metrics.setGauge(
        'outbox_lag_seconds',
        oldestPending
          ? Math.max(0, (Date.now() - oldestPending.createdAt.getTime()) / 1000)
          : 0,
      );
      const events = await em.transactional(async (tx) => {
        const now = new Date();
        const candidates = await tx.find(
          OutboxEventEntity,
          {
            $or: [
              { status: 'PENDING', availableAt: { $lte: now } },
              { status: 'PROCESSING', lockedUntil: { $lte: now } },
            ],
          },
          {
            limit: 10,
            orderBy: { createdAt: 'ASC' },
            lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
          },
        );
        for (const event of candidates) {
          event.status = 'PROCESSING';
          event.lockedUntil = new Date(now.getTime() + 30_000);
        }
        await tx.flush();
        return candidates.map((event) => ({
          id: event.id,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload,
          attempts: event.attempts,
        }));
      });

      for (const event of events) {
        try {
          await this.sqs.publishEvent(
            event.id,
            event.aggregateId,
            event.payload,
          );
          await em.nativeUpdate(
            OutboxEventEntity,
            { id: event.id },
            {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              lockedUntil: null,
              lastError: null,
            },
          );
        } catch (error) {
          const attempts = event.attempts + 1;
          const delaySeconds = Math.min(2 ** attempts, 300);
          await em.nativeUpdate(
            OutboxEventEntity,
            { id: event.id },
            {
              status: 'PENDING',
              attempts,
              lockedUntil: null,
              availableAt: new Date(Date.now() + delaySeconds * 1000),
              lastError:
                error instanceof Error
                  ? error.message.slice(0, 1000)
                  : 'unknown_error',
            },
          );
          this.metrics.increment('outbox_publish_retry_total');
          this.logger.error('outbox_publish_failed', error, {
            eventId: event.id,
            eventType: event.eventType,
          });
        }
      }
    } catch (error) {
      this.logger.error('outbox_batch_failed', error);
    }
  }
}
