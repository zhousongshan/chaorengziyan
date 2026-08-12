import type { AgentListQuery } from "@chaoren/contracts";

export const AGENT_REPOSITORY = Symbol("AGENT_REPOSITORY");

export interface AgentRecord {
  id: string;
  ownerUserId: string | null;
  name: string;
  description: string;
  agentInstruction: string;
  type: "image" | "video";
  mode: "normal" | "intelligent";
  createdAt: string;
  updatedAt: string;
}

export type AgentListFilter = AgentListQuery & { createdAfter?: string };
export type CreateAgentResult = "created" | "name_conflict";
export type RenameAgentResult = "renamed" | "not_found" | "name_conflict";

export interface AgentRepository {
  save(record: AgentRecord): Promise<void>;
  createVisibleUnique(record: AgentRecord): Promise<CreateAgentResult>;
  findVisibleById(id: string, ownerUserId: string): Promise<AgentRecord | undefined>;
  listVisible(
    ownerUserId: string,
    filter: AgentListFilter
  ): Promise<{ items: AgentRecord[]; total: number }>;
  renameOwnedUnique(
    id: string,
    ownerUserId: string,
    name: string,
    updatedAt: string
  ): Promise<RenameAgentResult>;
  hasOwnedSessions(id: string, ownerUserId: string): Promise<boolean>;
  archiveOwned(id: string, ownerUserId: string, archivedAt: string): Promise<boolean>;
  deleteOwned(id: string, ownerUserId: string): Promise<boolean>;
}

export function normalizeAgentName(name: string): string {
  return name.trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN");
}
