import type { ApiStatus } from "@remotefit/core/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteFooter, StaleDataNotice } from "../components/SiteFooter.js";
import { MethodPage } from "./MethodPage.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const status: ApiStatus = {
  classifier: { promptVersion: "eligibility-v4", postprocessVersion: "postprocess-v3", model: "m" },
  acceptance: {
    state: "accepted",
    decidedAt: "2026-11-04",
    testSet: "test-v3",
    precision: 88 / 90,
    recall: 88 / 92,
    precisionCi: [0.923, 0.994],
    recallCi: [0.893, 0.983],
  },
  measuredCountries: ["CO"],
  pendingClassification: 0,
  dataGeneratedAt: "2026-11-05T09:30:00.000Z",
};

describe("MethodPage", () => {
  it("states the accepted figures with intervals, the LLM-assisted labels, the warning and the GitHub removal route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(status), { status: 200 })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MethodPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("97,8 %")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("95,7 %");
    expect(text).toContain("92,3 %–99,4 %");
    expect(text).toContain("con ayuda de un modelo de lenguaje");
    expect(text).toContain("Solo está medido para Colombia");
    expect(text).toContain("lee la oferta original antes de postular");
    const issue = screen.getByRole("link", { name: "issue en GitHub" });
    expect(issue.getAttribute("href")).toContain("/issues/new?template=retirar-oferta.yml");
    expect(text).not.toMatch(/@gmail|@hotmail|correo:/i); // no personal contact
  });
});

describe("stale data", () => {
  it("warns only when the published data is more than 3 days old", () => {
    const { rerender } = render(
      <StaleDataNotice status={status} now={new Date("2026-11-08T09:00:00Z")} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(<StaleDataNotice status={status} now={new Date("2026-11-09T10:00:00Z")} />);
    expect(screen.getByRole("alert").textContent).toContain("hace 4 días");
  });

  it("shows the data date in the footer", () => {
    render(
      <MemoryRouter>
        <SiteFooter status={status} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Datos actualizados el 5 de nov de 2026/)).toBeTruthy();
  });
});
