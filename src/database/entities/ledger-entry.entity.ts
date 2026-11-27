import { randomUUID } from 'node:crypto';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'ledger_entries' })
export class LedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' }) id: string = randomUUID();
  @Property({ fieldName: 'wallet_id', type: 'uuid' }) walletId!: string;
  @Property({ fieldName: 'transaction_id', type: 'uuid' })
  transactionId!: string;
  @Property({ length: 10 }) direction!: 'CREDIT' | 'DEBIT';
  @Property({ type: 'decimal', precision: 20, scale: 2 }) amount!: string;
  @Property({
    fieldName: 'balance_before',
    type: 'decimal',
    precision: 20,
    scale: 2,
  })
  balanceBefore!: string;
  @Property({
    fieldName: 'balance_after',
    type: 'decimal',
    precision: 20,
    scale: 2,
  })
  balanceAfter!: string;
  @Property({ length: 3 }) currency!: string;
  @Property({
    fieldName: 'created_at',
    columnType: 'timestamptz',
    onCreate: () => new Date(),
  })
  createdAt = new Date();
}
