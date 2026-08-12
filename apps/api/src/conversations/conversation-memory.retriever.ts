import type { ConversationState } from "@chaoren/contracts";

import type { ConversationMemoryEntryRecord } from "./conversation.repository.js";

export interface ConversationRequirementEffect {
  field: string;
  status: "active" | "superseded";
}

export interface OlderConversationMemoryIndexEntry {
  turnNumber: number;
  summary: string;
  status: "active" | "superseded" | "rejected" | "historical";
  fieldChanges: ConversationRequirementEffect[];
  assetIds: string[];
}

export interface ConversationMemoryRetrieverInput {
  entries: ConversationMemoryEntryRecord[];
  firstRecentTurn: number;
  state: ConversationState;
}

export interface ConversationMemoryRetriever {
  retrieve(input: ConversationMemoryRetrieverInput): OlderConversationMemoryIndexEntry[];
}

export class StructuredConversationMemoryRetriever implements ConversationMemoryRetriever {
  public retrieve(input: ConversationMemoryRetrieverInput): OlderConversationMemoryIndexEntry[] {
    return input.entries
      .filter((entry) => entry.turnNumber < input.firstRecentTurn)
      .map((entry) => {
        const changedFields = readStringArray(entry.structuredData.changedFields);
        return {
          turnNumber: entry.turnNumber,
          summary: readString(entry.structuredData.summary) ?? entry.content.slice(0, 1_000),
          status: entry.status,
          fieldChanges: changedFields.map((field) => ({
            field,
            status:
              input.state.fieldSources[field]?.turnNumber === entry.turnNumber
                ? ("active" as const)
                : ("superseded" as const)
          })),
          assetIds: readStringArray(entry.structuredData.assetIds)
        };
      })
      .sort((left, right) => {
        const leftActive = left.fieldChanges.some((change) => change.status === "active") ? 1 : 0;
        const rightActive = right.fieldChanges.some((change) => change.status === "active") ? 1 : 0;
        return rightActive - leftActive || right.turnNumber - left.turnNumber;
      });
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
