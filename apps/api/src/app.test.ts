import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("api", () => {
  it("answers /health", async () => {
    const server = createApp().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      expect(await response.json()).toEqual({ status: "ok" });
    } finally {
      server.close();
    }
  });
});
