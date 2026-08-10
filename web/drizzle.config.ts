import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit is used for two things only: generating migration SQL from
 * `lib/db/schema.ts`, and checking that the schema in code still matches the
 * database. It is never run at request time — the app talks to Postgres through
 * `lib/server/db.ts`.
 */
export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Only read by `drizzle-kit push`/`studio`, never by the app.
    url: process.env.DATABASE_URL ?? "",
  },
  // The tables predate this file; keep generated SQL free of ownership noise.
  verbose: true,
  strict: true,
} satisfies Config;
