import { getConfigPath, getConfigs } from "../lib/utils.js";
import type { FrontClawSchema } from "@workspace/schema";

export type ContextCompactionRuntimeConfig = {
  contextWindowLimit: number;
  compactWhenTokensReach: number;
  autoCompact: boolean;
  preserveRecentMessages: number;
  targetRatioAfterCompact: number;
};

export type ContextCompactionResult = {
  compacted: boolean;
  reason: "auto" | "manual";
  beforeTokens: number;
  afterTokens: number;
  deletedMessages: number;
  preservedMessages: number;
  summaryMessageId?: string;
};

export type ConversationContextMetrics = {
  estimatedPromptTokens: number;
  contextWindowLimit: number;
  tokensRemaining: number;
  utilizationRatio: number;
  compactWhenTokensReach: number;
  tokensUntilCompaction: number;
  autoCompact: boolean;
  preserveRecentMessages: number;
  historyMessageCount: number;
};

export type ContextMessage = {
  id: string;
  role: string;
  content: string;
};

export function parsePagingValue(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function toContextMessages(
  rows: Array<{ id: string; role: string; content: string }>,
): ContextMessage[] {
  return rows.map((entry) => ({
    id: entry.id,
    role: entry.role,
    content: entry.content,
  }));
}

export type ConversationHistoryMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  return messages.reduce(
    (total, message) => total + estimateTokens(message.content) + 4,
    0,
  );
}

export function resolveContextCompactionConfig(
  config: FrontClawSchema | null | undefined,
): ContextCompactionRuntimeConfig {
  const raw = config?.context_management;
  const contextWindowLimit = Math.max(1024, raw?.context_window_limit ?? 128000);
  const compactWhenRatio =
    raw?.compact_when_ratio !== undefined
      ? Math.min(Math.max(raw.compact_when_ratio, 0.05), 1)
      : 0.85;
  const compactWhenTokensReach = Math.max(
    1,
    Math.min(
      contextWindowLimit,
      raw?.compact_when_tokens_reach ??
        Math.floor(contextWindowLimit * compactWhenRatio),
    ),
  );
  const targetRatioAfterCompact =
    raw?.target_ratio_after_compact !== undefined
      ? Math.min(Math.max(raw.target_ratio_after_compact, 0.1), 0.95)
      : 0.55;

  return {
    contextWindowLimit,
    compactWhenTokensReach,
    autoCompact: raw?.auto_compact ?? true,
    preserveRecentMessages: Math.max(2, raw?.preserve_recent_messages ?? 16),
    targetRatioAfterCompact,
  };
}

export async function loadContextCompactionConfigFromDisk(): Promise<ContextCompactionRuntimeConfig> {
  try {
    const configPath = getConfigPath();
    if (!configPath) return resolveContextCompactionConfig(undefined);
    const configs = (await getConfigs(configPath)) as FrontClawSchema;
    return resolveContextCompactionConfig(configs);
  } catch {
    return resolveContextCompactionConfig(undefined);
  }
}

export function computeConversationContextMetrics(params: {
  requestedMessage?: string;
  finalSystemPrompt: string;
  historyMessages: ConversationHistoryMessage[];
  config: ContextCompactionRuntimeConfig;
}): ConversationContextMetrics {
  const estimatedPromptTokens = estimateMessagesTokens([
    { role: "system", content: params.finalSystemPrompt },
    ...params.historyMessages,
    ...(params.requestedMessage
      ? [{ role: "user", content: params.requestedMessage }]
      : []),
  ]);
  const contextWindowLimit = params.config.contextWindowLimit;
  const tokensRemaining = Math.max(0, contextWindowLimit - estimatedPromptTokens);
  const utilizationRatio =
    contextWindowLimit > 0 ? estimatedPromptTokens / contextWindowLimit : 0;
  const tokensUntilCompaction = Math.max(
    0,
    params.config.compactWhenTokensReach - estimatedPromptTokens,
  );

  return {
    estimatedPromptTokens,
    contextWindowLimit,
    tokensRemaining,
    utilizationRatio,
    compactWhenTokensReach: params.config.compactWhenTokensReach,
    tokensUntilCompaction,
    autoCompact: params.config.autoCompact,
    preserveRecentMessages: params.config.preserveRecentMessages,
    historyMessageCount: params.historyMessages.length,
  };
}

export function toConversationHistoryMessages(
  historyRows: ContextMessage[],
  options?: { excludeMessageIds?: Set<string> },
): ConversationHistoryMessage[] {
  const mapped: ConversationHistoryMessage[] = [];

  for (const entry of historyRows) {
    if (options?.excludeMessageIds?.has(entry.id)) continue;
    if (
      entry.role === "system" ||
      entry.role === "user" ||
      entry.role === "assistant"
    ) {
      mapped.push({ role: entry.role, content: entry.content });
    }
  }

  return mapped;
}

export function buildConversationMetrics(params: {
  historyRows: ContextMessage[];
  finalSystemPrompt: string;
  requestedMessage?: string;
  config: ContextCompactionRuntimeConfig;
  excludeMessageIds?: Set<string>;
}): {
  historyMessages: ConversationHistoryMessage[];
  metrics: ConversationContextMetrics;
} {
  const historyMessages = toConversationHistoryMessages(params.historyRows, {
    excludeMessageIds: params.excludeMessageIds,
  });

  const metrics = computeConversationContextMetrics({
    requestedMessage: params.requestedMessage,
    finalSystemPrompt: params.finalSystemPrompt,
    historyMessages,
    config: params.config,
  });

  return { historyMessages, metrics };
}

export async function compactConversationContext(params: {
  messages: ContextMessage[];
  config: ContextCompactionRuntimeConfig;
  reason: "auto" | "manual";
  force?: boolean;
  retainMessageIds?: string[];
  summarizeTranscript: (transcript: string) => Promise<string>;
  persistSummaryMessage: (payload: {
    summaryText: string;
    targetAfterTokens: number;
    compactedMessageCount: number;
    reason: "auto" | "manual";
  }) => Promise<{ id?: string; content: string } | null>;
  deleteMessagesByIds: (messageIds: string[]) => Promise<number>;
  touchConversation?: () => Promise<void>;
}): Promise<ContextCompactionResult> {
  const retainIds = new Set(params.retainMessageIds ?? []);
  const eligible = params.messages.filter(
    (row) =>
      (row.role === "system" || row.role === "user" || row.role === "assistant") &&
      !retainIds.has(row.id),
  );

  const beforeTokens = estimateMessagesTokens(
    eligible.map((row) => ({ role: row.role, content: row.content })),
  );

  if (!params.force && beforeTokens < params.config.compactWhenTokensReach) {
    return {
      compacted: false,
      reason: params.reason,
      beforeTokens,
      afterTokens: beforeTokens,
      deletedMessages: 0,
      preservedMessages: eligible.length,
    };
  }

  if (eligible.length <= params.config.preserveRecentMessages + 1) {
    return {
      compacted: false,
      reason: params.reason,
      beforeTokens,
      afterTokens: beforeTokens,
      deletedMessages: 0,
      preservedMessages: eligible.length,
    };
  }

  const compactCount = Math.max(
    1,
    eligible.length - params.config.preserveRecentMessages,
  );
  const rowsToCompact = eligible.slice(0, compactCount);
  const rowsToKeep = eligible.slice(compactCount);

  const transcriptRows: string[] = [];
  for (const row of rowsToCompact) {
    transcriptRows.push(`[${row.role}] ${row.content}`);
  }
  let transcript = transcriptRows.join("\n\n");
  const maxTranscriptChars = Math.max(
    8000,
    Math.floor(params.config.contextWindowLimit * 6),
  );
  if (transcript.length > maxTranscriptChars) {
    transcript = transcript.slice(transcript.length - maxTranscriptChars);
  }

  let summaryText = "";
  try {
    summaryText = (await params.summarizeTranscript(transcript)).trim();
  } catch {
    summaryText = "";
  }

  if (!summaryText) {
    summaryText = `Conversation context compacted from ${rowsToCompact.length} messages. Key history is preserved in this compressed checkpoint.`;
  }

  const targetAfterTokens = Math.floor(
    params.config.contextWindowLimit * params.config.targetRatioAfterCompact,
  );
  const summaryMessage = await params.persistSummaryMessage({
    summaryText,
    targetAfterTokens,
    compactedMessageCount: rowsToCompact.length,
    reason: params.reason,
  });

  const deletedMessages = await params.deleteMessagesByIds(
    rowsToCompact.map((row) => row.id),
  );
  await params.touchConversation?.();

  const afterTokens = estimateMessagesTokens([
    ...(summaryMessage ? [{ role: "system", content: summaryMessage.content }] : []),
    ...rowsToKeep.map((row) => ({ role: row.role, content: row.content })),
  ]);

  return {
    compacted: deletedMessages > 0,
    reason: params.reason,
    beforeTokens,
    afterTokens,
    deletedMessages,
    preservedMessages: rowsToKeep.length,
    summaryMessageId: summaryMessage?.id,
  };
}
