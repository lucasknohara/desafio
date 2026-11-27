import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';
import { ProviderIdentityGuard } from '../../infrastructure/auth/provider-identity.guard.js';

@Module({
  imports: [InfrastructureModule],
  controllers: [WalletsController],
  providers: [WalletsService, ProviderIdentityGuard],
  exports: [WalletsService],
})
export class WalletsModule {}
