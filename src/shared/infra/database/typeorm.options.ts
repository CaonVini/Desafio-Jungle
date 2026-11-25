import { DataSourceOptions } from "typeorm";

export function buildTypeOrmOptions(): DataSourceOptions {
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