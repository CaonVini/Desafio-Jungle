import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOutboxEvents1795573000000 implements MigrationInterface {
  name = "CreateOutboxEvents1795573000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE outbox_events (
        id               uuid         NOT NULL,
        transaction_id   uuid         NOT NULL,
        event_type       varchar(64)  NOT NULL,
        payload          jsonb        NOT NULL,
        status           varchar(16)  NOT NULL DEFAULT 'PENDING',
        attempts         integer      NOT NULL DEFAULT 0,
        last_error       text,
        next_attempt_at  timestamptz  NOT NULL DEFAULT now(),
        created_at       timestamptz  NOT NULL DEFAULT now(),
        published_at     timestamptz,

        CONSTRAINT pk_outbox_events PRIMARY KEY (id),
        CONSTRAINT uq_outbox_events_transaction_event UNIQUE (transaction_id, event_type),
        CONSTRAINT fk_outbox_events_transaction FOREIGN KEY (transaction_id) REFERENCES wager_transactions (id) ON DELETE RESTRICT,
        CONSTRAINT ck_outbox_events_status CHECK (status IN ('PENDING','PUBLISHED'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_outbox_events_pending
      ON outbox_events (next_attempt_at, created_at)
      WHERE status = 'PENDING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS outbox_events`);
  }
}
