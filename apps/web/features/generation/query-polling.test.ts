import { describe, expect, it } from "vitest";

import {
  activeGenerationPollingInterval,
  conversationPollingInterval,
  readinessPollingInterval
} from "./query-polling";

describe("generation query polling", () => {
  it("stops polling an idle conversation", () => {
    expect(conversationPollingInterval(null)).toBe(false);
    expect(conversationPollingInterval("00000000-0000-4000-8000-000000000001")).toBe(1_500);
  });

  it("checks a healthy worker less frequently", () => {
    expect(readinessPollingInterval("ready")).toBe(30_000);
    expect(readinessPollingInterval("not_ready")).toBe(5_000);
  });

  it("polls until the active endpoint no longer returns a task", () => {
    expect(activeGenerationPollingInterval(null)).toBe(false);
    expect(activeGenerationPollingInterval({ status: "running" })).toBe(3_000);
    expect(activeGenerationPollingInterval({ status: "succeeded" })).toBe(3_000);
    expect(
      activeGenerationPollingInterval({ status: "succeeded", workflowStatus: "succeeded" })
    ).toBe(3_000);
  });
});
