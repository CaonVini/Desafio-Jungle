import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWagerTransactions1795571772314 implements MigrationInterface {
  name = "CreateWagerTransactions1795571772314";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wager_transactions (
        id                                 uuid          NOT NULL DEFAULT gen_random_uuid(),
        provider_id                        varchar(64)   NOT NULL,
        external_transaction_id            varchar(128)  NOT NULL,
        idempotency_key                    varchar(256)  NOT NULL,
        payload_hash                       char(64)      NOT NULL,
        wallet_id                          uuid          NOT NULL,
        player_id                          uuid          NOT NULL,
        round_id                           varchar(128)  NOT NULL,
        game_id                            varchar(128)  NOT NULL,
        kind                               varchar(16)   NOT NULL,
        amount                             numeric(19,2) NOT NULL,
        currency                           char(3)       NOT NULL,
        reference_external_transaction_id  varchar(128),
        reference_transaction_id           uuid,
        status                             varchar(24)   NOT NULL DEFAULT 'PENDING',
        failure_code                       varchar(64),
        reference_attempts                 integer       NOT NULL DEFAULT 0,
        next_attempt_at                    timestamptz,
        created_at                         timestamptz   NOT NULL DEFAULT now(),
        processed_at                       timestamptz,

        CONSTRAINT pk_wager_transactions PRIMARY KEY (id),
        CONSTRAINT uq_wager_transactions_provider_external UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT uq_wager_transactions_provider_idempotency UNIQUE (provider_id, idempotency_key),
        CONSTRAINT fk_wager_transactions_wallet FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE RESTRICT,
        CONSTRAINT fk_wager_transactions_reference FOREIGN KEY (reference_transaction_id) REFERENCES wager_transactions (id) ON DELETE RESTRICT,
        CONSTRAINT ck_wager_transactions_kind CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        CONSTRAINT ck_wager_transactions_status CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        CONSTRAINT ck_wager_transactions_amount_non_negative CHECK (amount >= 0),
        CONSTRAINT ck_wager_transactions_reference_required CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
        CONSTRAINT ck_wager_transactions_failure_code CHECK ((status IN ('REJECTED','FAILED')) = (failure_code IS NOT NULL))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_wager_transactions_single_reversal
      ON wager_transactions (reference_transaction_id, kind)
      WHERE status = 'PROCESSED' AND kind IN ('REFUND','ROLLBACK')
    `);

    await queryRunner.query(`
      CREATE INDEX idx_wager_transactions_pending_reference
      ON wager_transactions (next_attempt_at)
      WHERE status = 'PENDING_REFERENCE'
    `);

    await queryRunner.query(`
      CREATE FUNCTION wager_transactions_guard() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'wager_transactions: rows cannot be deleted'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF OLD.status IN ('PROCESSED','REJECTED','FAILED') AND NEW IS DISTINCT FROM OLD THEN
          RAISE EXCEPTION 'wager_transactions: terminal transaction % cannot be modified', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW.status = 'PENDING' AND OLD.status <> 'PENDING' THEN
          RAISE EXCEPTION 'wager_transactions: invalid status transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_wager_transactions_guard
      BEFORE UPDATE OR DELETE ON wager_transactions
      FOR EACH ROW EXECUTE FUNCTION wager_transactions_guard()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wager_transactions`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS wager_transactions_guard()`);
  }
}