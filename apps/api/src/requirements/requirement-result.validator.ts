import { Injectable } from "@nestjs/common";

import { requirementResultSchema, type RequirementResult } from "@chaoren/contracts";

import type {
  RequirementExecutionConstraints,
  RequirementValidationIssue
} from "./requirement-ai.port.js";

export type RequirementValidationResult =
  | { success: true; data: RequirementResult }
  | { success: false; issues: RequirementValidationIssue[] };

@Injectable()
export class RequirementResultValidator {
  public validate(
    input: unknown,
    constraints: RequirementExecutionConstraints
  ): RequirementValidationResult {
    const parsed = requirementResultSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "$",
          message: issue.message
        }))
      };
    }

    if (parsed.data.status === "needs_clarification") {
      return { success: true, data: parsed.data };
    }

    const issues: RequirementValidationIssue[] = [];
    const { imageCount, aspectRatio } = parsed.data.finalRequirement;

    if (imageCount > constraints.maxImageCount) {
      issues.push({
        field: "finalRequirement.imageCount",
        message: `图片数量必须在 1-${constraints.maxImageCount} 之间，实际为 ${imageCount}`
      });
    }

    if (!constraints.allowedAspectRatios.includes(aspectRatio)) {
      issues.push({
        field: "finalRequirement.aspectRatio",
        message: `图片比例必须是 ${constraints.allowedAspectRatios.join("、")} 之一，实际为 ${aspectRatio}`
      });
    }

    return issues.length > 0 ? { success: false, issues } : { success: true, data: parsed.data };
  }
}
