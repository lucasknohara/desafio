import {
  HttpException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SqsService } from './sqs.service.js';
import { WageringService } from '../../modules/wagering/wagering.service.js';
import { CreateWagerDto } from '../../modules/wagering/dto/create-wager.dto.js';
import { MetricsService } from '../observability/metrics.service.js';
import { StructuredLogger } from '../observability/structured-logger.service.js';

@Injectable()
export class SqsConsumerWorker implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopping = false;
  private activePoll: Promise<void> | null = null;

  constructor(
    private readonly sqs: SqsService,
    private readonly wagering: WageringService,
    private readonly metrics: MetricsService,
    private readonly logger: StructuredLogger,
  ) {}

  onModuleInit(): void {
    if (this.sqs.enabled) {
      this.timer = setInterval(() => {
        if (!this.activePoll) {
          this.activePoll = this.poll().finally(() => {
            this.activePoll = null;
          });
        }
      }, 1500);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.activePoll;
  }

  private async poll(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      const messages = await this.sqs.receiveWagers();
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message) continue;
        if (this.stopping) {
          const remaining = messages.slice(index);
          await Promise.all(
            remaining.map(async (pending) => {
              try {
                await this.sqs.deferMessage(pending, 1);
              } catch (error) {
                this.logger.error(
                  'sqs_shutdown_visibility_release_failed',
                  error,
                  {
                    messageId: pending.MessageId,
                  },
                );
              }
            }),
          );
          break;
        }
        try {
          const body = JSON.parse(message.Body ?? '{}') as Record<
            string,
            unknown
          >;
          const { idempotencyKey, correlationId, ...command } = body;
          if (typeof idempotencyKey !== 'string' || !message.MessageId)
            throw new Error('Invalid queue envelope');
          const dto = plainToInstance(CreateWagerDto, command);
          const errors = await validate(dto);
          if (errors.length) throw new Error('Queue message validation failed');
          await this.wagering.process(
            dto,
            idempotencyKey,
            {
              consumerName: 'wager-transaction-consumer',
              messageId: message.MessageId,
            },
            typeof correlationId === 'string'
              ? correlationId
              : message.MessageId,
          );
          await this.sqs.acknowledge(message);
        } catch (error) {
          if (
            error instanceof HttpException &&
            error.getStatus() >= 400 &&
            error.getStatus() < 500
          ) {
            await this.sqs.acknowledge(message);
            this.logger.log('sqs_business_message_rejected', {
              messageId: message.MessageId,
              statusCode: error.getStatus(),
            });
            continue;
          }
          this.metrics.increment('wager_queue_retry_total');
          const attempt = Number(
            message.Attributes?.ApproximateReceiveCount ?? 1,
          );
          const delaySeconds = Math.min(2 ** attempt * 5, 300);
          await this.sqs
            .deferMessage(message, delaySeconds)
            .catch((deferError: unknown) => {
              this.logger.error('sqs_visibility_extension_failed', deferError, {
                messageId: message.MessageId,
              });
            });
          this.logger.error('sqs_message_processing_failed', error, {
            messageId: message.MessageId,
            attempt,
          });
        }
      }
    } catch (error) {
      this.logger.error('sqs_poll_failed', error);
    } finally {
      this.running = false;
    }
  }
}
