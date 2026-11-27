import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProviderIdentityGuard } from '../../infrastructure/auth/provider-identity.guard.js';
import { CreateWagerDto } from './dto/create-wager.dto.js';
import { SqsService } from '../../infrastructure/sqs/sqs.service.js';

@UseGuards(ProviderIdentityGuard)
@Controller('queue')
export class QueueController {
  constructor(private readonly sqs: SqsService) {}
  @Post('wagering')
  @HttpCode(202)
  async enqueue(
    @Body() dto: CreateWagerDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (!key)
      throw new BadRequestException('Idempotency-Key header is required');
    if (key.length > 180)
      throw new BadRequestException('Idempotency-Key is too long');
    await this.sqs.enqueueWager(
      dto as unknown as Record<string, unknown>,
      key,
      dto.walletId,
      correlationId ?? randomUUID(),
    );
    return { accepted: true, queue: 'wager-transactions.fifo' };
  }
}
