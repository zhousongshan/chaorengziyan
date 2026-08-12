import { describe, expect, it } from "vitest";

import { recoverLatestCompletedTurnRequirement } from "./conversation-result-recovery";

const latestRequirementRun = {
  sourceMessageId: "00000000-0000-4000-8000-000000000011",
  requirementRunId: "00000000-0000-4000-8000-000000000012",
  result: {
    schemaVersion: "1.0" as const,
    status: "needs_clarification" as const,
    questions: ["请确认需求"],
    conflictDecisions: []
  }
};

const messages = [
  {
    id: latestRequirementRun.sourceMessageId,
    role: "user" as const,
    status: "completed" as const,
    turnNumber: 2
  }
];

describe("conversation result recovery", () => {
  it("recovers a requirement only when it belongs to the latest completed turn", () => {
    expect(
      recoverLatestCompletedTurnRequirement({
        sessionVersion: 2,
        processingMessageId: null,
        messages,
        latestRequirementRun
      })
    ).toEqual(latestRequirementRun);
  });

  it("does not reuse an older requirement while a newer turn is processing or completed", () => {
    expect(
      recoverLatestCompletedTurnRequirement({
        sessionVersion: 2,
        processingMessageId: "00000000-0000-4000-8000-000000000099",
        messages,
        latestRequirementRun
      })
    ).toBeNull();
    expect(
      recoverLatestCompletedTurnRequirement({
        sessionVersion: 3,
        processingMessageId: null,
        messages: [
          ...messages,
          {
            id: "00000000-0000-4000-8000-000000000013",
            role: "user",
            status: "completed",
            turnNumber: 3
          }
        ],
        latestRequirementRun
      })
    ).toBeNull();
  });
});
