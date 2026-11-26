import { MigrationInterface, QueryRunner } from "typeorm";

export class RecreateInboxMessages1795670000000 implements MigrationInterface {
  name = "RecreateInboxMessages1795670000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_messages`);
    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        consumer_name  varchar(64)  NOT NULL,
        message_id     varchar(128) NOT NULL,
        message_type   varchar(64)  NOT NULL,
        received_at    timestamptz  NOT NULL DEFAULT now(),

        CONSTRAINT pk_inbox_messages PRIMARY KEY (consumer_name, message_id)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_messages`);
    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        message_id    uuid         NOT NULL,
        event_type    varchar(64)  NOT NULL,
        processed_at  timestamptz  NOT NULL DEFAULT now(),

        CONSTRAINT pk_inbox_messages PRIMARY KEY (message_id)
      )
    `);
  }
}
