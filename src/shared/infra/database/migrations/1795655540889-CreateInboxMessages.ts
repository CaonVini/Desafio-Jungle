import { MigrationInterface, QueryRunner } from "typeorm";


export class CreateInboxMessages1795655540889 implements MigrationInterface {
  name = "CreateInboxMessages1795655540889";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        message_id    uuid         NOT NULL,
        event_type    varchar(64)  NOT NULL,
        processed_at  timestamptz  NOT NULL DEFAULT now(),

        CONSTRAINT pk_inbox_messages PRIMARY KEY (message_id)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_messages`);
  }
}