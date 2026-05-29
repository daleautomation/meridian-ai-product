import { neon } from "@neondatabase/serverless";

export type NeonSql = ReturnType<typeof neon>;

let appSql: NeonSql | null = null;
let directSql: NeonSql | null = null;

function assertPostgresUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid Postgres connection URL`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must use postgres:// or postgresql://`);
  }
  return value;
}

export function validateDatabaseUrl(value = process.env.DATABASE_URL, name = "DATABASE_URL"): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required when MERIDIAN_TRUTH_STORE uses Neon`);
  }
  return assertPostgresUrl(value.trim(), name);
}

function resolveDatabaseUrl(options: { direct?: boolean }): string | undefined {
  if (options.direct) {
    return (
      process.env.DIRECT_DATABASE_URL?.trim()
      ?? process.env.DATABASE_URL?.trim()
      ?? process.env.POSTGRES_URL?.trim()
    );
  }
  return process.env.DATABASE_URL?.trim() ?? process.env.POSTGRES_URL?.trim();
}

export function getDatabaseUrl(options: { direct?: boolean } = {}): string {
  const value = resolveDatabaseUrl(options);
  const name = options.direct
    ? process.env.DIRECT_DATABASE_URL
      ? "DIRECT_DATABASE_URL"
      : process.env.DATABASE_URL
        ? "DATABASE_URL"
        : "POSTGRES_URL"
    : process.env.DATABASE_URL
      ? "DATABASE_URL"
      : "POSTGRES_URL";
  return validateDatabaseUrl(value, name);
}

export function getNeonSql(options: { direct?: boolean } = {}): NeonSql {
  if (options.direct) {
    directSql ??= neon(getDatabaseUrl({ direct: true }));
    return directSql;
  }
  appSql ??= neon(getDatabaseUrl());
  return appSql;
}
