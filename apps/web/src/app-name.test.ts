import { describe, expect, it } from "vitest";
import { APP_NAME } from "./app-name.js";

describe("web app", () => {
  it("has a name", () => {
    expect(APP_NAME).toBe("RemoteFit");
  });
});
