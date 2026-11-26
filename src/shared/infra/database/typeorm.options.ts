import type { DataSourceOptions } from "typeorm";

type PostgresConnectionOptions = Extract<DataSourceOptions, { type: "postgres" }>;

function sessionOptions(): string {
  const lockTimeoutMs = Number(process.env.DB_LOCK_TIMEOUT_MS ?? 5000);
  const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000);
  const idleInTransactionMs = Number(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS ?? 30000);
  return [
    `-c lock_timeout=${lockTimeoutMs}`,
    `-c statement_timeout=${statementTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${idleInTransactionMs}`,
  ].join(" ");
}

export function buildTypeOrmOptions(): PostgresConnectionOptions {
  return {
    type: "postgres",
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? "wagering",
    password: process.env.DB_PASSWORD ?? "wagering",
    database: process.env.DB_NAME ?? "wagering",
    entities: ["src/**/*.orm-entity.ts"],
    migrations: ["src/shared/infra/database/migrations/*.ts"],
    synchronize: false,
    extra: { options: sessionOptions() },
  };
}
