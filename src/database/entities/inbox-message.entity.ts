import { randomUUID } from 'node:crypto';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'uuid' }) id: string = randomUUID();
  @Property({ fieldName: 'consumer_name', length: 120 }) consumerName!: string;
  @Property({ fieldName: 'message_id', length: 180 }) messageId!: string;
  @Property({ fieldName: 'payload_hash', length: 64, nullable: true })
  payloadHash: string | null = null;
  @Property({ fieldName: 'transaction_id', type: 'uuid', nullable: true })
  transactionId: string | null = null;
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
}
