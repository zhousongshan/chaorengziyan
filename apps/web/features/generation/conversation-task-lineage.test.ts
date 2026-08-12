import { describe, expect, it } from "vitest";

import type { ConversationHistoryResponse } from "@chaoren/contracts";

import { findGenerationTurnNumber } from "./conversation-task-lineage";

describe("conversation task lineage", () => {
  it("maps a task to its authoritative source turn instead of the last turn", () => {
    const history = {
      messages: [
        { id: "00000000-0000-4000-8000-000000000011", turnNumber: 1 },
        { id: "00000000-0000-4000-8000-000000000012", turnNumber: 2 },
        { id: "00000000-0000-4000-8000-000000000013", turnNumber: 3 }
      ],
      requirementRuns: [
        {
          sourceMessageId: "00000000-0000-4000-8000-000000000011",
          requirementRunId: "00000000-0000-4000-8000-000000000021"
        },
        {
          sourceMessageId: "00000000-0000-4000-8000-000000000012",
          requirementRunId: "00000000-0000-4000-8000-000000000022"
        }
      ]
    } as Pick<ConversationHistoryResponse, "messages" | "requirementRuns">;

    expect(findGenerationTurnNumber(history, "00000000-0000-4000-8000-000000000021")).toBe(1);
    expect(findGenerationTurnNumber(history, "00000000-0000-4000-8000-000000000022")).toBe(2);
  });

  it("returns null when legacy data has no structured lineage", () => {
    expect(
      findGenerationTurnNumber({ messages: [], requirementRuns: [] }, crypto.randomUUID())
    ).toBe(null);
  });
});
