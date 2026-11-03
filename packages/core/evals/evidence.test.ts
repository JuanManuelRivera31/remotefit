import { describe, expect, it } from "vitest";
import { verifyEvidence, type EvidenceJob } from "./evidence.js";

const job: EvidenceJob = {
  title: "Tech Lead — Users & Auth - Mexico City (Hybrid)",
  locationRaw: "Mexico City / CDMX / Mexico | Brasil | Colombia",
  workplaceType: "hybrid",
  descriptionText:
    "Location: This is a Globally remote role.\nWe're remote-first, flexible and distributed.",
};

describe("verifyEvidence", () => {
  it("accepts literal quotes of the body, with or without a Location prefix and curly apostrophes", () => {
    expect(verifyEvidence("Location: This is a Globally remote role.", job)).toBe("literal");
    expect(verifyEvidence("We’re remote-first, flexible and distributed.", job)).toBe("literal");
  });

  it("accepts metadata-style evidence only when the structured fields agree", () => {
    expect(
      verifyEvidence("LOCATION: Mexico City / CDMX / Mexico; ATS_WORKPLACE_TYPE: hybrid", job),
    ).toBe("metadata");
    expect(verifyEvidence("LOCATION: Mexico City; ATS_WORKPLACE_TYPE: remote", job)).toBe(
      "fail_unverified",
    );
    expect(verifyEvidence('[metadata] location "Colombia", workplaceType "Hybrid"', job)).toBe(
      "metadata",
    );
  });

  it("rejects missing, paraphrased and elided evidence", () => {
    expect(verifyEvidence(null, job)).toBe("fail_missing");
    expect(verifyEvidence("", job)).toBe("fail_missing");
    expect(
      verifyEvidence(
        "We are remote-first, flexible, and distributed across North and South America.",
        job,
      ),
    ).toBe("fail_unverified");
    expect(verifyEvidence("This role is fully remote.", job)).toBe("fail_unverified");
  });

  it("matches titles with an em dash against the labeller's plain dash", () => {
    expect(verifyEvidence("TITLE: Tech Lead - Users & Auth - Mexico City (Hybrid)", job)).toBe(
      "metadata",
    );
  });
});
