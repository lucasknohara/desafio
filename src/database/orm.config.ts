import 'dotenv/config';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { WalletEntity } from './entities/wallet.entity.js';
import { WagerTransactionEntity } from './entities/wager-transaction.entity.js';
import { LedgerEntryEntity } from './entities/ledger-entry.entity.js';
import { InboxMessageEntity } from './entities/inbox-message.entity.js';
import { OutboxEventEntity } from './entities/outbox-event.entity.js';

export const createOrmConfig = () =>
  defineConfig({
    entities: [
      WalletEntity,
      WagerTransactionEntity,
      LedgerEntryEntity,
      InboxMessageEntity,
      OutboxEventEntity,
    ],
    dbName: process.env.POSTGRES_DB ?? 'jungle_gaming',
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'jungle',
    password: process.env.POSTGRES_PASSWORD ?? 'jungle_local_password',
    extensions: [Migrator],
    metadataProvider: ReflectMetadataProvider,
    migrations: {
      path: './dist/database/migrations',
      pathTs: './src/database/migrations',
      glob: '!(*.d).{js,ts}',
      transactional: true,
    },
    debug: process.env.NODE_ENV === 'development',
  });

export default createOrmConfig();
