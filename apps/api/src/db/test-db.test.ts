import { describe, expect, it } from "vitest";
import { assertTestDatabaseName, resolveTestDatabaseUrl } from "./test-db.js";

describe("resolveTestDatabaseUrl", () => {
  const url = "postgres://u:p@localhost:5433/remotefit_test";

  it("skips (null) when the URL is missing outside a full run", () => {
    expect(resolveTestDatabaseUrl({})).toBeNull();
  });

  it("fails when the URL is missing in a full run", () => {
    expect(() => resolveTestDatabaseUrl({ RF_REQUIRE_DB_TESTS: "1" })).toThrow(
      /TEST_DATABASE_URL is not set/,
    );
  });

  it("returns the URL when it points to a _test database", () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: url, RF_REQUIRE_DB_TESTS: "1" })).toBe(url);
  });

  it("refuses a URL that points to the real database", () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@localhost:5433/remotefit" }),
    ).toThrow(/must end in "_test"/);
  });
});

describe("assertTestDatabaseName", () => {
  it("accepts names ending in _test", () => {
    expect(() => assertTestDatabaseName("remotefit_test")).not.toThrow();
    expect(() => assertTestDatabaseName("other_project_test")).not.toThrow();
  });

  it.each(["remotefit", "postgres", "remotefit_test_old", "test", "_test", "", "remotefit-test"])(
    "refuses %j",
    (name) => {
      expect(() => assertTestDatabaseName(name)).toThrow(/must end in "_test"/);
    },
  );
});
