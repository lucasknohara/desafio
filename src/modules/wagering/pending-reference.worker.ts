import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { WagerTransactionEntity } from '../../database/entities/wager-transaction.entity.js';
import { WageringService } from './wagering.service.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
import { StructuredLogger } from '../../infrastructure/observability/structured-logger.service.js';

@Injectable()
export class PendingReferenceWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private activeBatch: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly em: EntityManager,
    private readonly wagering: WageringService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (!this.activeBatch && !this.stopping) {
        this.activeBatch = this.runBatch().finally(() => {
          this.activeBatch = null;
        });
      }
    }, 5000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.activeBatch;
  }

  private async runBatch(): Promise<void> {
    try {
      const rows = await this.em.fork().find(
        WagerTransactionEntity,
        {
          status: 'PENDING_REFERENCE',
          $or: [
            { nextAttemptAt: null },
            { nextAttemptAt: { $lte: new Date() } },
          ],
        },
        { limit: 20, orderBy: { createdAt: 'ASC' } },
      );

      for (const row of rows) {
        if (this.stopping) break;

        try {
          await this.wagering.retryPendingReference(row.id);
          this.metrics.increment('wager_reference_retry_total');
        } catch (error) {
          this.logger.error('pending_reference_retry_failed', error, {
            transactionId: row.id,
            walletId: row.walletId,
            providerId: row.providerId,
          });
        }
      }
    } catch (error) {
      this.logger.error('pending_reference_worker_failed', error);
    }
  }
}
