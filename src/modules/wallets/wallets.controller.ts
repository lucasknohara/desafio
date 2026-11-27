import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProviderIdentityGuard } from '../../infrastructure/auth/provider-identity.guard.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';
import { WalletsService } from './wallets.service.js';

@UseGuards(ProviderIdentityGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  create(@Body() dto: CreateWalletDto) {
    return this.wallets.create(dto);
  }

  @Get(':walletId')
  findById(@Param('walletId') walletId: string) {
    return this.wallets.findById(walletId);
  }

  @Get(':walletId/ledger')
  ledger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.wallets.getLedger(walletId, cursor, limit);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  reconcile(@Param('walletId') walletId: string) {
    return this.wallets.reconcile(walletId);
  }
}
