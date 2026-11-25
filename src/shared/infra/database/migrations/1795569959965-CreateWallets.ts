import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWallets1795569959965 implements MigrationInterface {
  name = "CreateWallets1795569959965";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE wallets (
        id          uuid          NOT NULL DEFAULT gen_random_uuid(),
        player_id   uuid          NOT NULL,
        currency    char(3)       NOT NULL,
        balance     numeric(19,2) NOT NULL DEFAULT 0,
        version     integer       NOT NULL DEFAULT 1,
        created_at  timestamptz   NOT NULL DEFAULT now(),
        updated_at  timestamptz   NOT NULL DEFAULT now(),

        CONSTRAINT pk_wallets PRIMARY KEY (id),
        CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency),
        CONSTRAINT ck_wallets_balance_non_negative CHECK (balance >= 0),
        CONSTRAINT ck_wallets_version_positive CHECK (version >= 1),
        CONSTRAINT ck_wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$')
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION wallets_before_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.player_id IS DISTINCT FROM OLD.player_id
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'wallets: id, player_id, currency and created_at are immutable'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;

        IF NEW.balance IS DISTINCT FROM OLD.balance THEN
          NEW.version := OLD.version + 1;
          NEW.updated_at := now();
        ELSE
          NEW.version := OLD.version;
          NEW.updated_at := OLD.updated_at;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_wallets_before_update
      BEFORE UPDATE ON wallets
      FOR EACH ROW EXECUTE FUNCTION wallets_before_update()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wallets`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS wallets_before_update()`);
  }
}