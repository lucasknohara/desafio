import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProviderIdentityGuard } from '../../infrastructure/auth/provider-identity.guard.js';
import { CreateWagerDto } from './dto/create-wager.dto.js';
import { WageringService } from './wagering.service.js';

@UseGuards(ProviderIdentityGuard)
@Controller('wagering')
export class WageringController {
  constructor(private readonly wagering: WageringService) {}

  @Post('transactions')
  async process(
    @Body() dto: CreateWagerDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (key.length > 180) {
      throw new BadRequestException('Idempotency-Key is too long');
    }

    const result = await this.wagering.process(
      dto,
      key,
      undefined,
      correlationId,
    );

    if (result.status === 'REJECTED') {
      response.status(422);
    } else if (result.status === 'PENDING_REFERENCE') {
      response.status(202);
    } else {
      response.status(201);
    }

    return result;
  }

  @Get('transactions/:transactionId')
  findById(@Param('transactionId') transactionId: string) {
    return this.wagering.findById(transactionId);
  }
}
