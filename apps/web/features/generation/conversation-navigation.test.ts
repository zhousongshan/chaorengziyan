import { describe, expect, it } from "vitest";

import { creationUrl } from "./conversation-navigation";

describe("conversation navigation", () => {
  it("creates a clean URL for a historical session", () => {
    expect(
      creationUrl({
        agentId: "00000000-0000-4000-8000-000000000010",
        sessionId: "00000000-0000-4000-8000-000000000020"
      })
    ).toBe(
      "/create/image?agentId=00000000-0000-4000-8000-000000000010&sessionId=00000000-0000-4000-8000-000000000020"
    );
  });

  it("creates the base creation URL without workflow parameters", () => {
    expect(creationUrl({})).toBe("/create/image");
  });
});
