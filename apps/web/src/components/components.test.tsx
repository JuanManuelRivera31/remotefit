import type { ApiStatus, JobSummary } from "@remotefit/core/api";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { Excerpt } from "./Excerpt.js";
import { JobCard } from "./JobCard.js";
import { StatusBanner } from "./StatusBanner.js";

afterEach(cleanup);

const status = (state: ApiStatus["acceptance"]["state"]): ApiStatus => ({
  classifier: { promptVersion: "eligibility-v4", postprocessVersion: "postprocess-v3", model: "m" },
  acceptance: {
    state,
    decidedAt: null,
    testSet: null,
    precision: state === "not_accepted" ? null : 0.93,
    recall: null,
    precisionCi: null,
    recallCi: null,
  },
  measuredCountries: ["CO"],
  dataGeneratedAt: null,
  pendingClassification: 0,
});

const job: JobSummary = {
  id: 7,
  title: "Backend Engineer",
  company: "Acme",
  location: "Remote - LATAM",
  url: "https://jobs.example.com/7",
  verdict: "applicable",
  label: "latam_eligible",
  workModel: "remote",
  countries: [],
  seniority: "senior",
  ageDays: 200,
  stale: true,
  lastVerifiedAt: "2026-11-04T15:00:00.000Z",
  evidence: ["We hire anywhere in Latin America"],
  siblingCount: 1,
  siblingLocations: ["Mexico City, Mexico"],
  groupCountries: ["CO", "MX"],
};

describe("StatusBanner", () => {
  it("warns while the version is not accepted and disappears once it is", () => {
    const { rerender } = render(<StatusBanner status={status("not_accepted")} />);
    expect(screen.getByRole("alert").textContent).toContain("no aceptada");
    rerender(<StatusBanner status={status("accepted")} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the measured precision when accepted with a gap", () => {
    render(<StatusBanner status={status("accepted_with_gap")} />);
    expect(screen.getByRole("status").textContent).toContain("93,0 %");
  });
});

describe("JobCard", () => {
  it("shows the quote, the original link, the last verification date and the stale badge", () => {
    render(
      <MemoryRouter>
        <JobCard job={job} detailHref="/ofertas/7" country="CO" />
      </MemoryRouter>,
    );
    expect(screen.getByText("“We hire anywhere in Latin America”")).toBeTruthy();
    const original = screen.getByRole("link", { name: /oferta original/ });
    expect(original.getAttribute("href")).toBe(job.url);
    expect(original.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/Vista activa el 4 de nov de 2026/)).toBeTruthy();
    expect(screen.getByText("Más de 180 días")).toBeTruthy();
    expect(screen.getByText("Remoto desde Latinoamérica")).toBeTruthy();
    expect(screen.getByText(/2 publicaciones de la misma vacante/)).toBeTruthy();
    // The user's country is highlighted in the vacancy's country list; the others are plain text.
    expect(screen.getByText("Colombia").tagName).toBe("STRONG");
    expect(screen.getByText(/México/).tagName).not.toBe("STRONG");
  });

  it("marks unconfirmed postings", () => {
    render(
      <MemoryRouter>
        <JobCard
          job={{ ...job, verdict: "unconfirmed", label: "unclear" }}
          detailHref="/ofertas/7"
          country="CO"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Sin confirmar")).toBeTruthy();
    // Not confirmed for the user's country: no highlight.
    expect(screen.queryByText("Colombia", { selector: "strong" })).toBeNull();
  });
});

describe("Excerpt", () => {
  it("highlights the quote inside its context", () => {
    const { container } = render(
      <Excerpt excerpt={{ before: "…our team. ", match: "Remote in LATAM", after: " only. …" }} />,
    );
    expect(container.querySelector("mark")?.textContent).toBe("Remote in LATAM");
    expect(container.textContent).toBe("…our team. Remote in LATAM only. …");
  });
});
