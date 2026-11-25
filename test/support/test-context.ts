import { expect } from "bun:test";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { OutboxPublisherService } from "../../src/outbox/application/outbox-publisher.service";
import { MessagePublisher } from "../../src/outbox/domain/message-publisher";
import { OutboxModule } from "../../src/outbox/outbox.module";
import { PersistenceModule } from "../../src/persistence.module";
import { buildTypeOrmOptions } from "../../src/shared/infra/database/typeorm.options";
import { ProcessWagerTransactionUseCase } from "../../src/wagering/application/process-wager-transaction.use-case";
import { WageringModule } from "../../src/wagering/wagering.module";
import { CreateWalletUseCase } from "../../src/wallet/application/create-wallet.use-case";
import { GetWalletUseCase } from "../../src/wallet/application/get-wallet.use-case";
import { WalletModule } from "../../src/wallet/wallet.module";
import { FakeMessagePublisher } from "./fake-message-publisher";
import { prepareTestDatabase, TEST_DATABASE } from "./test-database";

export interface TestContext {
  moduleRef: TestingModule;
  dataSource: DataSource;
  processTransaction: ProcessWagerTransactionUseCase;
  createWallet: CreateWalletUseCase;
  getWallet: GetWalletUseCase;
  outboxPublisher: OutboxPublisherService;
  broker: FakeMessagePublisher;
  reset(): Promise<void>;
  close(): Promise<void>;
  ledgerCount(walletId: string, direction?: "DEBIT" | "CREDIT"): Promise<number>;
  invariant(walletId: string): Promise<{ balance: string; ledger: string }>;
  outboxEvents(): Promise<OutboxRow[]>;
}

export interface OutboxRow {
  transaction_id: string;
  event_type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
}

export async function createTestContext(): Promise<TestContext> {
  await prepareTestDatabase();

  const broker = new FakeMessagePublisher();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot({
        ...buildTypeOrmOptions(),
        database: TEST_DATABASE,
        entities: [],
        migrations: [],
        autoLoadEntities: true,
      }),
      PersistenceModule,
      OutboxModule,
      WalletModule,
      WageringModule,
    ],
  })
    .overrideProvider(MessagePublisher)
    .useValue(broker)
    .compile();
  await moduleRef.init();

  const dataSource = moduleRef.get(DataSource, { strict: false });

  return {
    moduleRef,
    dataSource,
    processTransaction: moduleRef.get(ProcessWagerTransactionUseCase, { strict: false }),
    createWallet: moduleRef.get(CreateWalletUseCase, { strict: false }),
    getWallet: moduleRef.get(GetWalletUseCase, { strict: false }),
    outboxPublisher: moduleRef.get(OutboxPublisherService, { strict: false }),
    broker,

    async reset() {
      broker.sent.length = 0;
      broker.failing = false;
      if (dataSource.options.database !== TEST_DATABASE) {
        throw new Error("Refusing to truncate a database that is not the test database");
      }
      await dataSource.query(
        "TRUNCATE TABLE outbox_events, wallet_ledger_entries, wager_transactions, wallets RESTART IDENTITY CASCADE",
      );
    },

    async close() {
      await moduleRef.close();
    },

    async ledgerCount(walletId, direction) {
      const rows = await dataSource.query(
        `SELECT count(*)::int AS total
           FROM wallet_ledger_entries
          WHERE wallet_id = $1 AND ($2::text IS NULL OR direction::text = $2)`,
        [walletId, direction ?? null],
      );
      return rows[0].total;
    },

    async outboxEvents() {
      return dataSource.query(
        `SELECT transaction_id, event_type, status, attempts, payload
           FROM outbox_events
          ORDER BY created_at, id`,
      );
    },

    async invariant(walletId) {
      const rows = await dataSource.query(
        `SELECT w.balance::text AS balance,
                COALESCE(SUM(CASE WHEN l.direction::text = 'CREDIT' THEN l.amount ELSE -l.amount END), 0.00)::text AS ledger
           FROM wallets w
           LEFT JOIN wallet_ledger_entries l ON l.wallet_id = w.id
          WHERE w.id = $1
          GROUP BY w.id`,
        [walletId],
      );
      return rows[0];
    },
  };
}

export async function expectInvariant(context: TestContext, walletId: string): Promise<void> {
  const { balance, ledger } = await context.invariant(walletId);
  expect(balance).toBe(ledger);
}