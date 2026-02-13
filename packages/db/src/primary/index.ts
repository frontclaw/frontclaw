import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.PRIMARY_DATABASE_URL!;
const usePreparedStatements =
  process.env.DB_USE_PREPARED_STATEMENTS === "true";

if (!connectionString) {
  throw new Error("PRIMARY_DATABASE_URL is required");
}

const client = postgres(connectionString, {
  // Default to PgBouncer/transaction-pooling compatible mode.
  prepare: usePreparedStatements,
});

export const primaryDB = drizzle(client, {
  schema,
});
