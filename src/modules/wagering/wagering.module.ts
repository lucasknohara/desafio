import { Module } from '@nestjs/common';
import { WageringController } from './wagering.controller.js';
import { ProviderTransactionsController } from './provider-transactions.controller.js';
import { QueueController } from './queue.controller.js';
import { WageringService } from './wagering.service.js';
import { PendingReferenceWorker } from './pending-reference.worker.js';
import { SqsConsumerWorker } from '../../infrastructure/sqs/sqs-consumer.worker.js';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { ProviderIdentityGuard } from '../../infrastructure/auth/provider-identity.guard.js';

@Module({
  imports: [InfrastructureModule],
  controllers: [
    WageringController,
    ProviderTransactionsController,
    QueueController,
  ],
  providers: [
    WageringService,
    PendingReferenceWorker,
    SqsConsumerWorker,
    ProviderIdentityGuard,
  ],
  exports: [WageringService],
})
export class WageringModule {}
