// Full test run (`npm test` at the repo root). It marks the run as complete with RF_REQUIRE_DB_TESTS=1, so the
// database tests in apps/api FAIL instead of being skipped when TEST_DATABASE_URL is missing. Running a single
// workspace (`npm test -w packages/core`, `npx vitest ...`) still skips them, which keeps quick local loops cheap.
import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["test", "--workspaces", "--if-present"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, RF_REQUIRE_DB_TESTS: "1" },
});
process.exit(result.status ?? 1);
