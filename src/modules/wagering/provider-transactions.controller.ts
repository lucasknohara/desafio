import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ProviderIdentityGuard } from '../../infrastructure/auth/provider-identity.guard.js';
import { WageringService } from './wagering.service.js';

@UseGuards(ProviderIdentityGuard)
@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionsController {
  constructor(private readonly wagering: WageringService) {}
  @Get(':externalTransactionId')
  find(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.wagering.findByProviderExternalId(
      providerId,
      externalTransactionId,
    );
  }
}
