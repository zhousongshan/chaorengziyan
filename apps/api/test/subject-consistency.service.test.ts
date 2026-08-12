import { describe, expect, it } from "vitest";

import { type SubjectConsistencyCheck } from "@chaoren/contracts";

import { aggregateWorkflowStatus } from "../src/subject-consistency/subject-consistency.service.js";

describe("subject consistency workflow status", () => {
  it("returns partial delivery only after every check reaches a terminal state", () => {
    const passed = check("completed", "passed");
    const rejected = {
      ...check("completed", "rejected"),
      checkId: "00000000-0000-4000-8000-000000000031"
    };

    expect(aggregateWorkflowStatus("succeeded", [passed, rejected])).toBe("partially_passed");
    expect(aggregateWorkflowStatus("succeeded", [passed, { ...rejected, status: "running" }])).toBe(
      "running"
    );
  });

  it("treats an unusable source image as a terminal non-deliverable result", () => {
    expect(aggregateWorkflowStatus("succeeded", [check("source_unusable", null)])).toBe(
      "source_unusable"
    );
  });
});

function check(
  status: SubjectConsistencyCheck["status"],
  verdict: SubjectConsistencyCheck["verdict"]
): SubjectConsistencyCheck {
  return {
    checkId: "00000000-0000-4000-8000-000000000030",
    generationTaskId: "00000000-0000-4000-8000-000000000020",
    requirementRunId: "00000000-0000-4000-8000-000000000021",
    sourceProductAssetIds: ["00000000-0000-4000-8000-000000000040"],
    generatedAsset: {
      id: "00000000-0000-4000-8000-000000000041",
      projectId: "00000000-0000-4000-8000-000000000010",
      kind: "image",
      mimeType: "image/png",
      byteSize: 100,
      createdAt: new Date().toISOString()
    },
    status,
    phase: "initial_inspection",
    verdict,
    attempts: [],
    reconciliation: null,
    userMessage: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
