import {
  type ConversationMessage,
  type ConversationState,
  type CreateConversationMessageRequest
} from "@chaoren/contracts";
import type { ConversationMemoryEntryRecord } from "./conversation.repository.js";
import {
  StructuredConversationMemoryRetriever,
  type ConversationMemoryRetriever,
  type ConversationRequirementEffect,
  type OlderConversationMemoryIndexEntry
} from "./conversation-memory.retriever.js";

export interface ConversationTurnContext {
  turnNumber: number;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    assets: ConversationMessage["assets"];
  }>;
  requirementEffects: ConversationRequirementEffect[];
}

export interface RetrievedConversationMemory extends ConversationTurnContext {
  reason: "explicit_turn_reference" | "state_provenance" | "text_relevance";
}

export interface ConversationAssetMemory {
  assetId: string;
  role: ConversationMessage["assets"][number]["role"];
  caption: string;
  ocrText: string | null;
  productFacts: Record<string, unknown>;
  creativeFacts: Record<string, unknown>;
}

export interface ConversationRequirementContext {
  sessionState: Omit<ConversationState, "renderSettings" | "deliverySettings">;
  recentTurns: ConversationTurnContext[];
  retrievedLongTermMemory: RetrievedConversationMemory[];
  olderMemoryIndex: OlderConversationMemoryIndexEntry[];
  assetMemories: ConversationAssetMemory[];
  currentTurn: {
    text: string;
    imageSettings: CreateConversationMessageRequest["imageSettings"];
    agentInstruction: string;
    attachments: CreateConversationMessageRequest["attachments"];
  };
}

export class ConversationContextLimitError extends Error {
  public constructor(
    public readonly actualCharacters: number,
    public readonly maximumCharacters: number,
    public readonly actualTokens?: number,
    public readonly maximumTokens?: number
  ) {
    super(
      actualTokens !== undefined && maximumTokens !== undefined && actualTokens > maximumTokens
        ? `最近20轮完整上下文超过模型Token预算（估算${actualTokens}/${maximumTokens} Token）`
        : `最近20轮完整上下文超过限制（${actualCharacters}/${maximumCharacters}字符）`
    );
    this.name = "ConversationContextLimitError";
  }
}

export class ConversationContextAssembler {
  public constructor(
    private readonly memoryRetriever: ConversationMemoryRetriever = new StructuredConversationMemoryRetriever()
  ) {}

  public assemble(input: {
    messages: ConversationMessage[];
    currentMessageId: string;
    currentRequest: CreateConversationMessageRequest;
    state: ConversationState;
    recentTurnCount: number;
    maximumCharacters: number;
    maximumTokens?: number;
    imageCount?: number;
    imageTokenEstimate?: number;
    assetMemories?: ConversationAssetMemory[];
    memoryEntries?: ConversationMemoryEntryRecord[];
  }): ConversationRequirementContext {
    const previousMessages = input.messages.filter(
      (message) => message.id !== input.currentMessageId && message.status === "completed"
    );
    const turns = annotateTurns(
      groupTurns(previousMessages),
      input.memoryEntries ?? [],
      input.state
    );
    const recentTurns = turns.slice(-input.recentTurnCount);
    const olderTurns = turns.slice(0, Math.max(0, turns.length - input.recentTurnCount));
    const aiState = {
      activeProductAssetIds: input.state.activeProductAssetIds,
      editBaseAssetId: input.state.editBaseAssetId,
      referenceAssetIds: input.state.referenceAssetIds,
      referenceGuidance: input.state.referenceGuidance,
      selectedResultAssetIds: input.state.selectedResultAssetIds,
      rejectedResultAssetIds: input.state.rejectedResultAssetIds,
      agentInstruction: input.state.agentInstruction,
      currentGenerationPlan: input.state.currentGenerationPlan,
      currentRequirement: input.state.currentRequirement,
      unresolvedQuestions: input.state.unresolvedQuestions,
      fieldSources: input.state.fieldSources
    };
    const requiredContext = {
      sessionState: aiState,
      recentTurns,
      olderMemoryIndex: [] as OlderConversationMemoryIndexEntry[],
      assetMemories: input.assetMemories ?? [],
      currentTurn: {
        text: input.currentRequest.text,
        imageSettings: input.currentRequest.imageSettings,
        agentInstruction: input.currentRequest.agentInstruction ?? input.state.agentInstruction,
        attachments: input.currentRequest.attachments
      }
    };
    const requiredCharacters = JSON.stringify(requiredContext).length;
    const requiredTokens =
      estimateContextTokens(requiredContext) +
      (input.imageCount ?? 0) * (input.imageTokenEstimate ?? 0);
    if (
      requiredCharacters > input.maximumCharacters ||
      (input.maximumTokens !== undefined && requiredTokens > input.maximumTokens)
    ) {
      throw new ConversationContextLimitError(
        requiredCharacters,
        input.maximumCharacters,
        requiredTokens,
        input.maximumTokens
      );
    }

    const olderMemoryIndex = this.memoryRetriever.retrieve({
      entries: input.memoryEntries ?? [],
      firstRecentTurn: recentTurns[0]?.turnNumber ?? Number.POSITIVE_INFINITY,
      state: input.state
    });
    const retrievedLongTermMemory = retrieveOlderTurns({
      olderTurns,
      currentText: input.currentRequest.text,
      state: input.state
    });
    const remainingCharacters = input.maximumCharacters - requiredCharacters;
    const remainingTokens = (input.maximumTokens ?? Number.POSITIVE_INFINITY) - requiredTokens;
    const selectedMemories: RetrievedConversationMemory[] = [];
    let usedCharacters = 0;
    let usedTokens = 0;
    const selectedIndex: OlderConversationMemoryIndexEntry[] = [];
    for (const entry of olderMemoryIndex) {
      const size = JSON.stringify(entry).length;
      const tokens = estimateContextTokens(entry);
      if (usedCharacters + size > remainingCharacters || usedTokens + tokens > remainingTokens) {
        continue;
      }
      selectedIndex.push(entry);
      usedCharacters += size;
      usedTokens += tokens;
    }
    for (const memory of retrievedLongTermMemory) {
      const size = JSON.stringify(memory).length;
      const tokens = estimateContextTokens(memory);
      if (usedCharacters + size > remainingCharacters || usedTokens + tokens > remainingTokens) {
        continue;
      }
      selectedMemories.push(memory);
      usedCharacters += size;
      usedTokens += tokens;
    }

    return {
      ...requiredContext,
      olderMemoryIndex: selectedIndex,
      retrievedLongTermMemory: selectedMemories
    };
  }
}

export function estimateContextTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let tokens = 0;
  let asciiRun = 0;
  const flushAscii = () => {
    if (asciiRun === 0) return;
    tokens += Math.ceil(asciiRun / 4);
    asciiRun = 0;
  };
  for (const character of text) {
    if (/^[\x20-\x7E]$/.test(character)) {
      asciiRun += 1;
      continue;
    }
    flushAscii();
    tokens += 1;
  }
  flushAscii();
  return tokens;
}

function groupTurns(messages: ConversationMessage[]): ConversationTurnContext[] {
  const byTurn = new Map<number, ConversationTurnContext>();
  for (const message of messages) {
    const turn = byTurn.get(message.turnNumber) ?? {
      turnNumber: message.turnNumber,
      messages: [],
      requirementEffects: []
    };
    turn.messages.push({
      role: message.role,
      content: message.content,
      assets: message.assets
    });
    byTurn.set(message.turnNumber, turn);
  }
  return [...byTurn.values()].sort((left, right) => left.turnNumber - right.turnNumber);
}

function annotateTurns(
  turns: ConversationTurnContext[],
  entries: ConversationMemoryEntryRecord[],
  state: ConversationState
): ConversationTurnContext[] {
  const entriesByTurn = new Map(entries.map((entry) => [entry.turnNumber, entry]));
  return turns.map((turn) => ({
    ...turn,
    requirementEffects: readChangedFields(entriesByTurn.get(turn.turnNumber)).map((field) => ({
      field,
      status: state.fieldSources[field]?.turnNumber === turn.turnNumber ? "active" : "superseded"
    }))
  }));
}

function readChangedFields(entry: ConversationMemoryEntryRecord | undefined): string[] {
  return entry ? readStringArray(entry.structuredData.changedFields) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function retrieveOlderTurns(input: {
  olderTurns: ConversationTurnContext[];
  currentText: string;
  state: ConversationState;
}): RetrievedConversationMemory[] {
  const explicitTurns = new Set(extractTurnReferences(input.currentText));
  const provenanceTurns = new Set(
    Object.values(input.state.fieldSources).map((source) => source.turnNumber)
  );
  const queryTerms = tokenize(input.currentText);
  return input.olderTurns
    .map((turn) => {
      if (explicitTurns.has(turn.turnNumber)) {
        return { ...turn, reason: "explicit_turn_reference" as const, score: 10_000 };
      }
      if (provenanceTurns.has(turn.turnNumber)) {
        return { ...turn, reason: "state_provenance" as const, score: 5_000 };
      }
      const text = turn.messages
        .map((message) => message.content)
        .join(" ")
        .toLowerCase();
      const score = queryTerms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
      return { ...turn, reason: "text_relevance" as const, score };
    })
    .filter((turn) => turn.score > 0)
    .sort((left, right) => right.score - left.score || right.turnNumber - left.turnNumber)
    .slice(0, 8)
    .map((turn) => ({
      turnNumber: turn.turnNumber,
      messages: turn.messages,
      requirementEffects: turn.requirementEffects,
      reason: turn.reason
    }));
}

export function extractTurnReferences(text: string): number[] {
  const references: number[] = [];
  for (const match of text.matchAll(/第\s*(\d{1,4})\s*轮/g)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) references.push(value);
  }
  return references;
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const chineseBlocks = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const chineseBigrams = chineseBlocks.flatMap((block) => {
    if (block.length <= 2) return [block];
    return Array.from({ length: block.length - 1 }, (_, index) => block.slice(index, index + 2));
  });
  return [...new Set([...latin, ...chineseBigrams])].filter(Boolean);
}
