import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { SqsService } from '../../infrastructure/sqs/sqs.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly orm: MikroORM,
    private readonly sqs: SqsService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.orm.em.getConnection().execute('select 1');
      await this.sqs.checkReady();
      return {
        status: 'ready',
        dependencies: {
          postgres: 'ok',
          sqs: this.sqs.enabled ? 'ok' : 'disabled',
        },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        dependencies: { postgres: 'unknown', sqs: 'unavailable' },
      });
    }
  }
}
