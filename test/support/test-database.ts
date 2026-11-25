import { DataSource } from "typeorm";
import { buildTypeOrmOptions } from "../../src/shared/infra/database/typeorm.options";

export const TEST_DATABASE = "wagering_test";

let prepared: Promise<void> | undefined;

async function prepare(): Promise<void> {
  const admin = new DataSource({ ...buildTypeOrmOptions(), entities: [], migrations: [] });
  await admin.initialize();
  const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DATABASE]);
  if (found.length === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
  }
  await admin.destroy();

  const target = new DataSource({ ...buildTypeOrmOptions(), database: TEST_DATABASE, entities: [] });
  await target.initialize();
  await target.runMigrations();
  await target.destroy();
}

export function prepareTestDatabase(): Promise<void> {
  prepared ??= prepare();
  return prepared;
}