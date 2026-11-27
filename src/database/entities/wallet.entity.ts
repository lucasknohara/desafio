import { randomUUID } from 'node:crypto';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'wallets' })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ fieldName: 'player_id', length: 120 })
  playerId!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ type: 'decimal', precision: 20, scale: 2 })
  balance = '0.00';

  @Property()
  version = 1;

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
