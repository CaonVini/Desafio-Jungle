import type { DataSourceOptions } from "typeorm";

type PostgresConnectionOptions = Extract<DataSourceOptions, { type: "postgres" }>;

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
  };
}