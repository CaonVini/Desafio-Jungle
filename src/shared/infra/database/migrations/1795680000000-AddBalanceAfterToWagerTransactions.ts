import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBalanceAfterToWagerTransactions1795680000000 implements MigrationInterface {
  name = "AddBalanceAfterToWagerTransactions1795680000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE wager_transactions
        ADD COLUMN balance_after numeric(19,2),
        ADD CONSTRAINT ck_wager_transactions_balance_after_non_negative
          CHECK (balance_after IS NULL OR balance_after >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE wager_transactions
        DROP CONSTRAINT ck_wager_transactions_balance_after_non_negative,
        DROP COLUMN balance_after
    `);
  }
}
