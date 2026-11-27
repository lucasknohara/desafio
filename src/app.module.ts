import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { createOrmConfig } from './database/orm.config.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { WageringModule } from './modules/wagering/wagering.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    MikroOrmModule.forRoot(createOrmConfig()),
    InfrastructureModule,
    WalletsModule,
    WageringModule,
    HealthModule,
  ],
})
export class AppModule {}
