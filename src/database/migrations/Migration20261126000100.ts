import { Migration } from '@mikro-orm/migrations';

export class Migration20261126000100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id uuid PRIMARY KEY,
        player_id varchar(120) NOT NULL,
        currency char(3) NOT NULL,
        balance numeric(20,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
        version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wallets_player_currency_unique UNIQUE (player_id, currency)
      );

      CREATE TABLE wager_transactions (
        id uuid PRIMARY KEY,
        provider_id varchar(120) NOT NULL,
        external_transaction_id varchar(180) NOT NULL,
        idempotency_key varchar(180) NOT NULL,
        payload_hash char(64) NOT NULL,
        player_id varchar(120) NOT NULL,
        wallet_id uuid NOT NULL REFERENCES wallets(id),
        round_id varchar(180) NOT NULL,
        type varchar(20) NOT NULL CHECK (type IN ('BET','WIN','LOSS','REFUND','ROLLBACK','OPENING')),
        status varchar(24) NOT NULL CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        amount numeric(20,2) NOT NULL CHECK (amount >= 0),
        currency char(3) NOT NULL,
        reference_external_transaction_id varchar(180),
        reference_transaction_id uuid REFERENCES wager_transactions(id),
        reversed_transaction_id uuid REFERENCES wager_transactions(id),
        balance_after numeric(20,2),
        failure_code varchar(80),
        response_snapshot jsonb,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wager_id_wallet_unique UNIQUE (id, wallet_id),
        CONSTRAINT wager_provider_external_unique UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wager_provider_idempotency_unique UNIQUE (provider_id, idempotency_key),
        CONSTRAINT wager_reversal_once_unique UNIQUE (reversed_transaction_id)
      );
      CREATE INDEX wager_pending_reference_idx ON wager_transactions(status, next_attempt_at)
        WHERE status = 'PENDING_REFERENCE';
      CREATE INDEX wager_wallet_created_idx ON wager_transactions(wallet_id, created_at DESC);

      CREATE TABLE ledger_entries (
        id uuid PRIMARY KEY,
        wallet_id uuid NOT NULL REFERENCES wallets(id),
        transaction_id uuid NOT NULL UNIQUE,
        direction varchar(10) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
        amount numeric(20,2) NOT NULL CHECK (amount > 0),
        balance_before numeric(20,2) NOT NULL CHECK (balance_before >= 0),
        balance_after numeric(20,2) NOT NULL CHECK (balance_after >= 0),
        currency char(3) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ledger_transaction_wallet_fk
          FOREIGN KEY (transaction_id, wallet_id) REFERENCES wager_transactions(id, wallet_id),
        CONSTRAINT ledger_balance_math CHECK (
          (direction = 'CREDIT' AND balance_after = balance_before + amount) OR
          (direction = 'DEBIT' AND balance_after = balance_before - amount)
        )
      );
      CREATE INDEX ledger_wallet_created_idx ON ledger_entries(wallet_id, created_at DESC, id DESC);

      CREATE TABLE inbox_messages (
        id uuid PRIMARY KEY,
        consumer_name varchar(120) NOT NULL,
        message_id varchar(180) NOT NULL,
        transaction_id uuid REFERENCES wager_transactions(id),
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT inbox_consumer_message_unique UNIQUE (consumer_name, message_id)
      );

      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY,
        event_type varchar(100) NOT NULL,
        aggregate_id uuid NOT NULL,
        payload jsonb NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PUBLISHED')),
        attempts integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL DEFAULT now(),
        locked_until timestamptz,
        published_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX outbox_pending_idx ON outbox_events(status, available_at, created_at);

      CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ledger entries are immutable';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ledger_immutable_before_update
        BEFORE UPDATE OR DELETE ON ledger_entries
        FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      DROP TRIGGER IF EXISTS ledger_immutable_before_update ON ledger_entries;
      DROP FUNCTION IF EXISTS prevent_ledger_mutation();
      DROP TABLE IF EXISTS outbox_events;
      DROP TABLE IF EXISTS inbox_messages;
      DROP TABLE IF EXISTS ledger_entries;
      DROP TABLE IF EXISTS wager_transactions;
      DROP TABLE IF EXISTS wallets;
    `);
  }
}
