import { Migration } from '@mikro-orm/migrations';

export class Migration20261127000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE inbox_messages
        ADD COLUMN payload_hash char(64);

      ALTER TABLE wager_transactions
        ADD COLUMN correlation_id varchar(120),
        DROP CONSTRAINT wager_transactions_amount_check,
        ADD CONSTRAINT wager_transactions_amount_positive CHECK (amount > 0);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE wager_transactions
        DROP CONSTRAINT IF EXISTS wager_transactions_amount_positive,
        ADD CONSTRAINT wager_transactions_amount_check CHECK (amount >= 0),
        DROP COLUMN IF EXISTS correlation_id;

      ALTER TABLE inbox_messages
        DROP COLUMN IF EXISTS payload_hash;
    `);
  }
}
