import { describe, expect, it } from "vitest";

import { formatConversationTime } from "./conversation-time";

describe("formatConversationTime", () => {
  it("shows only the time for a message from today", () => {
    expect(
      formatConversationTime("2026-08-11T08:05:00.000Z", new Date("2026-08-11T12:00:00.000Z"))
    ).toBe(localExpected("2026-08-11T08:05:00.000Z", "time"));
  });

  it("includes the date for an older message", () => {
    const value = "2026-08-09T08:05:00.000Z";
    const formatted = formatConversationTime(value, new Date("2026-08-11T12:00:00.000Z"));
    expect(formatted).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("includes the year when the message is from another year", () => {
    const formatted = formatConversationTime(
      "2025-08-09T08:05:00.000Z",
      new Date("2026-08-11T12:00:00.000Z")
    );
    expect(formatted).toMatch(/^2025-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

function localExpected(value: string, kind: "time") {
  const date = new Date(value);
  if (kind === "time") {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return "";
}
