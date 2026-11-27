import { randomUUID } from 'node:crypto';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import type { WagerStatus } from '../../domain/wagering/wager-transaction.js';

export type WagerType =
  'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK' | 'OPENING';
export type { WagerStatus } from '../../domain/wagering/wager-transaction.js';
export interface WagerResponseSnapshot {
  transactionId: string;
  status: WagerStatus;
  balance: string;
  currency: string;
  failureCode: string | null;
}

@Entity({ tableName: 'wager_transactions' })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ fieldName: 'provider_id', length: 120 }) providerId!: string;
  @Property({ fieldName: 'external_transaction_id', length: 180 })
  externalTransactionId!: string;
  @Property({ fieldName: 'idempotency_key', length: 180 })
  idempotencyKey!: string;
  @Property({ fieldName: 'payload_hash', length: 64 }) payloadHash!: string;
  @Property({ fieldName: 'player_id', length: 120 }) playerId!: string;
  @Property({ fieldName: 'wallet_id', type: 'uuid' }) walletId!: string;
  @Property({ fieldName: 'round_id', length: 180 }) roundId!: string;
  @Property({ fieldName: 'correlation_id', length: 120, nullable: true })
  correlationId: string | null = null;
  @Property({ length: 20 }) type!: WagerType;
  @Property({ length: 24 }) status: WagerStatus = 'PENDING';
  @Property({ type: 'decimal', precision: 20, scale: 2 }) amount!: string;
  @Property({ length: 3 }) currency!: string;
  @Property({
    fieldName: 'reference_external_transaction_id',
    length: 180,
    nullable: true,
  })
  referenceExternalTransactionId: string | null = null;
  @Property({
    fieldName: 'reference_transaction_id',
    type: 'uuid',
    nullable: true,
  })
  referenceTransactionId: string | null = null;
  @Property({
    fieldName: 'reversed_transaction_id',
    type: 'uuid',
    nullable: true,
  })
  reversedTransactionId: string | null = null;
  @Property({
    fieldName: 'balance_after',
    type: 'decimal',
    precision: 20,
    scale: 2,
    nullable: true,
  })
  balanceAfter: string | null = null;
  @Property({ fieldName: 'failure_code', length: 80, nullable: true })
  failureCode: string | null = null;
  @Property({
    type: 'json',
    columnType: 'jsonb',
    fieldName: 'response_snapshot',
    nullable: true,
  })
  responseSnapshot: WagerResponseSnapshot | null = null;
  @Property() attempts = 0;
  @Property({
    fieldName: 'next_attempt_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  nextAttemptAt: Date | null = null;
  @Property({
    fieldName: 'processed_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  processedAt: Date | null = null;
  @Property({
    fieldName: 'created_at',
    columnType: 'timestamptz',
    onCreate: () => new Date(),
  })
  createdAt = new Date();
  @Property({
    fieldName: 'updated_at',
    columnType: 'timestamptz',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
  })
  updatedAt = new Date();
}
