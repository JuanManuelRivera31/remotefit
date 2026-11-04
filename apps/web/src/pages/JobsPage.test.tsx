import type { JobsPage as JobsPageData } from "@remotefit/core/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobsPage } from "./JobsPage.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const emptyPage = (over: Partial<JobsPageData> = {}): JobsPageData => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 30,
  counts: { applicable: 0, unconfirmed: 2 },
  companies: [],
  ...over,
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function renderAt(url: string, respond: (requested: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      calls.push(input);
      return respond(input);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <JobsPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("JobsPage", () => {
  it("asks the API with the filters from the URL and explains an empty result", async () => {
    const calls = renderAt("/?pais=MX&nivel=junior", () => json(emptyPage()));
    expect(await screen.findByText(/No hay ofertas con estos filtros/)).toBeTruthy();
    expect(screen.getByText(/Hay 2 sin confirmar/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Sin medir");
    const query = new URLSearchParams(calls[0]?.split("?")[1]);
    expect(query.get("country")).toBe("MX");
    expect(query.get("seniority")).toBe("junior");
  });

  it("writes a filter change to the URL", async () => {
    renderAt("/", () => json(emptyPage()));
    await screen.findByText(/No hay ofertas/);
    expect(screen.queryByRole("note")).toBeNull(); // Colombia is measured
    fireEvent.click(screen.getByLabelText(/Ver sin confirmar/));
    expect(screen.getByTestId("location").textContent).toBe("?sin_confirmar=1");
  });

  it("shows an error state when the API fails", async () => {
    renderAt("/", () => json({ error: { code: "internal", message: "Internal error" } }, 500));
    expect((await screen.findByRole("alert")).textContent).toContain("No se pudieron cargar");
  });
});
