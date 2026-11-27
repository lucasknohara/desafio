import { randomUUID } from 'node:crypto';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'outbox_events' })
export class OutboxEventEntity {
  @PrimaryKey({ type: 'uuid' }) id: string = randomUUID();
  @Property({ fieldName: 'event_type', length: 100 }) eventType!: string;
  @Property({ fieldName: 'aggregate_id', type: 'uuid' }) aggregateId!: string;
  @Property({ type: 'json', columnType: 'jsonb' }) payload!: Record<
    string,
    unknown
  >;
  @Property({ length: 16 }) status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' =
    'PENDING';
  @Property() attempts = 0;
  @Property({
    fieldName: 'available_at',
    columnType: 'timestamptz',
    onCreate: () => new Date(),
  })
  availableAt = new Date();
  @Property({
    fieldName: 'locked_until',
    columnType: 'timestamptz',
    nullable: true,
  })
  lockedUntil: Date | null = null;
  @Property({
    fieldName: 'published_at',
    columnType: 'timestamptz',
    nullable: true,
  })
  publishedAt: Date | null = null;
  @Property({ fieldName: 'last_error', type: 'text', nullable: true })
  lastError: string | null = null;
  @Property({
    fieldName: 'created_at',
    columnType: 'timestamptz',
    onCreate: () => new Date(),
  })
  createdAt = new Date();
}
