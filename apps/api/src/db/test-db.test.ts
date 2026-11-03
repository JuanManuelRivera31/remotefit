import { describe, expect, it } from "vitest";
import { assertTestDatabaseName } from "./test-db.js";

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
