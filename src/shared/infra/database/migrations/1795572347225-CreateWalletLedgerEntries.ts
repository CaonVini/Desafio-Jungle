import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWalletLedgerEntries1795572347225 implements MigrationInterface {
  name = "CreateWalletLedgerEntries1795572347225";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wallet_ledger_entries (
        id              uuid          NOT NULL DEFAULT gen_random_uuid(),
        wallet_id       uuid          NOT NULL,
        transaction_id  uuid          NOT NULL,
        direction       varchar(6)    NOT NULL,
        amount          numeric(19,2) NOT NULL,
        currency        char(3)       NOT NULL,
        balance_before  numeric(19,2) NOT NULL,
        balance_after   numeric(19,2) NOT NULL,
        created_at      timestamptz   NOT NULL DEFAULT now(),

        CONSTRAINT pk_wallet_ledger_entries PRIMARY KEY (id),
        CONSTRAINT uq_wallet_ledger_entries_wallet_transaction UNIQUE (wallet_id, transaction_id),
        CONSTRAINT fk_wallet_ledger_entries_wallet FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE RESTRICT,
        CONSTRAINT fk_wallet_ledger_entries_transaction FOREIGN KEY (transaction_id) REFERENCES wager_transactions (id) ON DELETE RESTRICT,
        CONSTRAINT ck_wallet_ledger_entries_direction CHECK (direction IN ('DEBIT','CREDIT')),
        CONSTRAINT ck_wallet_ledger_entries_amount_positive CHECK (amount > 0),
        CONSTRAINT ck_wallet_ledger_entries_balances_non_negative CHECK (balance_before >= 0 AND balance_after >= 0),
        CONSTRAINT ck_wallet_ledger_entries_balanced CHECK (
          (direction = 'DEBIT' AND balance_after = balance_before - amount)
          OR (direction = 'CREDIT' AND balance_after = balance_before + amount)
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_wallet_ledger_entries_wallet_created
      ON wallet_ledger_entries (wallet_id, created_at DESC, id DESC)
    `);

    await queryRunner.query(`
      CREATE FUNCTION wallet_ledger_entries_immutable() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries: % is not allowed, the ledger is immutable', TG_OP
          USING ERRCODE = 'integrity_constraint_violation';
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_wallet_ledger_entries_immutable
      BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION wallet_ledger_entries_immutable()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wallet_ledger_entries`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS wallet_ledger_entries_immutable()`);
  }
}