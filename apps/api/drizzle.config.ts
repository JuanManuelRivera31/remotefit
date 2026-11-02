import { defineConfig } from "drizzle-kit";

// Used only by `npm run db:generate` (it reads schema.ts and needs no database connection).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
