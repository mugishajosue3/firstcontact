import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/signups/route";

const validBody = {
  accountType: "individual",
  name: "Test User",
  email: "test@example.com",
  location: "Remote",
  individualRole: "founder",
  summary: "Building something meaningful for people who lack good access.",
  context: "There is a lot of context that outsiders would miss about this space.",
  goals: ["raise-capital"],
  targetRegions: ["US"],
  referralSource: "search",
  consentToProcess: true,
  productUpdates: false,
  company: "",
};

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/signups", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/signups rate limiting", () => {
  it("does not count invalid submissions toward the rate limit", async () => {
    const ip = "203.0.113.10";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await POST(makeRequest({}, { "x-forwarded-for": ip }));
      expect(response.status).toBe(400);
    }

    // A well-formed request from the same IP right after should still get
    // through to the "not configured" branch rather than being rejected as
    // rate limited, since none of the prior invalid attempts should count.
    const response = await POST(makeRequest(validBody, { "x-forwarded-for": ip }));
    expect(response.status).toBe(503);
  });

  it("does not globally rate limit clients whose address cannot be determined", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await POST(makeRequest(validBody));
      expect(response.status).not.toBe(429);
    }
  });

  it("rate limits repeated well-formed submissions from the same identifiable client", async () => {
    const ip = "203.0.113.20";
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await POST(makeRequest(validBody, { "x-forwarded-for": ip }));
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("returns field-specific errors for an incomplete submission", async () => {
    const response = await POST(
      makeRequest(
        { ...validBody, individualRole: undefined },
        { "x-forwarded-for": "203.0.113.30" },
      ),
    );
    const payload = (await response.json()) as { fields?: Record<string, string[]> };

    expect(response.status).toBe(400);
    expect(payload.fields?.individualRole?.[0]).toBe(
      "Choose the role that best describes you",
    );
  });
});
