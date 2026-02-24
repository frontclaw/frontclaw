export type ChatPipelineMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ExecutedToolContext = {
  toolName: string;
  args: Record<string, unknown>;
  source: "tool" | "skill";
  result: unknown;
};

export type PersistedToolEvent = {
  type: "start" | "result" | "error";
  toolName: string;
  args?: Record<string, unknown>;
  source?: "tool" | "skill";
  durationMs?: number;
  resultPreview?: string;
  error?: string;
  startedAt?: number;
};

export class ToolTerminalResponseError extends Error {
  readonly terminalResponse: string;
  readonly toolName: string;
  readonly source: "tool" | "skill";

  constructor(
    terminalResponse: string,
    toolName: string,
    source: "tool" | "skill",
  ) {
    super(`Tool '${toolName}' ended request`);
    this.name = "ToolTerminalResponseError";
    this.terminalResponse = terminalResponse;
    this.toolName = toolName;
    this.source = source;
  }
}

export type ToolExecutionMode = "handoff_to_llm" | "end_request";

type ToolControlEnvelope = {
  __frontclaw?: {
    mode?: ToolExecutionMode;
    response?: unknown;
  };
  data?: unknown;
};

export function toTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function toPreview(value: unknown, maxLength = 400): string {
  const text = toTextContent(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function resolveToolOutputRouting(raw: unknown): {
  mode: ToolExecutionMode;
  llmPayload: unknown;
  terminalResponse?: string;
} {
  if (!raw || typeof raw !== "object") {
    return { mode: "handoff_to_llm", llmPayload: raw };
  }

  const envelope = raw as ToolControlEnvelope;
  const mode = envelope.__frontclaw?.mode;

  if (mode === "end_request") {
    const response =
      envelope.__frontclaw?.response !== undefined
        ? envelope.__frontclaw.response
        : envelope.data !== undefined
          ? envelope.data
          : raw;
    return {
      mode: "end_request",
      llmPayload: raw,
      terminalResponse: toTextContent(response),
    };
  }

  const handoffPayload = envelope.data !== undefined ? envelope.data : raw;
  return {
    mode: "handoff_to_llm",
    llmPayload: handoffPayload,
  };
}

export function hasConversationTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && title.trim().length > 0;
}

export function deriveConversationTitle(prompt: string): string {
  const maxLength = 150;
  const normalized = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#>\[\]\(\)]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "New conversation";
  }

  let title = normalized;
  const sentenceMatch = normalized.match(/^(.{1,150}?)([.!?]|$)/);
  if (sentenceMatch?.[1] && sentenceMatch[1].trim().length >= 8) {
    title = sentenceMatch[1].trim();
  }

  if (title.length > maxLength) {
    const shortened = title.slice(0, maxLength).trimEnd();
    const lastSpace = shortened.lastIndexOf(" ");
    title = lastSpace > 40 ? shortened.slice(0, lastSpace) : shortened;
  }

  return title;
}

export function normalizeConversationTitle(title: string): string {
  const maxLength = 150;
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.slice(0, maxLength);
}

export function toLLMMessages(
  messages: Array<{ role: string; content: string }>,
): ChatPipelineMessage[] {
  return messages
    .filter(
      (m) =>
        m.role === "system" || m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));
}

export function buildToolContext(
  tools: Array<{
    name: string;
    description?: string;
    parameters?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>,
  skills: Array<{
    name: string;
    description?: string;
    inputSchema?: {
      properties?: Record<string, unknown>;
      required?: string[];
    };
  }>,
): string {
  if (tools.length === 0 && skills.length === 0) {
    return "";
  }

  const lines: string[] = [
    "AVAILABLE TOOLS (LLM-CALLABLE):",
    "Call tools when needed. Use exact names and valid JSON arguments.",
  ];

  for (const tool of tools) {
    const properties = Object.keys(tool.parameters?.properties || {});
    const required = tool.parameters?.required || [];
    lines.push(
      `- ${tool.name}: ${tool.description || "No description"}; args=[${properties.join(", ")}]; required=[${required.join(", ")}]`,
    );
  }

  for (const skill of skills) {
    const properties = Object.keys(skill.inputSchema?.properties || {});
    const required = skill.inputSchema?.required || [];
    lines.push(
      `- ${skill.name}: ${skill.description || "No description"}; args=[${properties.join(", ")}]; required=[${required.join(", ")}]`,
    );
  }

  return lines.join("\n");
}

export function wantsStream(
  acceptHeader: string | undefined,
  body: { stream?: boolean },
): boolean {
  if (body.stream === true) return true;
  return (acceptHeader || "").includes("text/event-stream");
}

export async function fallbackFromToolResults(
  aiClient: {
    chat: (options: {
      messages: ChatPipelineMessage[];
      toolChoice?: "none";
    }) => Promise<{ content: string }>;
  },
  baseMessages: ChatPipelineMessage[],
  executedTools: ExecutedToolContext[],
): Promise<string> {
  if (executedTools.length === 0) return "";

  const fallbackResult = await aiClient.chat({
    messages: [
      ...baseMessages,
      {
        role: "assistant",
        content:
          "Tool execution finished. I will now synthesize a final answer using the tool outputs.",
      },
      {
        role: "user",
        content: `Tool outputs (JSON): ${JSON.stringify(executedTools)}`,
      },
      {
        role: "user",
        content:
          "Provide the best final response to the original user request using the tool outputs above.",
      },
    ],
    toolChoice: "none",
  });

  return fallbackResult.content || "";
}

export function createToolExecutor(params: {
  executeSkill: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; result?: unknown }>;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  emitToolEvent?: (event: string, payload: unknown) => void;
  onToolCompleted?: (tool: ExecutedToolContext) => void;
  onToolEvent?: (event: PersistedToolEvent) => void;
  onDebug?: (message: string, meta?: Record<string, unknown>) => void;
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}): (toolName: string, args: Record<string, unknown>) => Promise<unknown> {
  return async (toolName: string, args: Record<string, unknown>) => {
    params.onDebug?.("Tool execution started", { toolName, args });
    const startedAt = Date.now();
    const startEvent: PersistedToolEvent = {
      type: "start",
      toolName,
      args,
      startedAt,
    };
    params.onToolEvent?.(startEvent);
    params.emitToolEvent?.("tool_start", startEvent);

    try {
      const skillResult = await params.executeSkill(toolName, args);
      if (skillResult.success) {
        const durationMs = Date.now() - startedAt;
        params.onDebug?.("Skill execution completed", { toolName, durationMs });
        const routing = resolveToolOutputRouting(skillResult.result);
        params.onToolCompleted?.({
          toolName,
          args,
          source: "skill",
          result: routing.llmPayload,
        });
        const resultEvent: PersistedToolEvent = {
          type: "result",
          toolName,
          source: "skill",
          durationMs,
          resultPreview: toPreview(
            routing.mode === "end_request"
              ? routing.terminalResponse
              : routing.llmPayload,
          ),
        };
        params.onToolEvent?.(resultEvent);
        params.emitToolEvent?.("tool_result", resultEvent);
        if (routing.mode === "end_request") {
          throw new ToolTerminalResponseError(
            routing.terminalResponse || "",
            toolName,
            "skill",
          );
        }
        return routing.llmPayload;
      }

      const toolResult = await params.executeTool(toolName, args);
      if (!toolResult.success) {
        throw new Error(toolResult.error || "Tool execution failed");
      }

      const durationMs = Date.now() - startedAt;
      params.onDebug?.("Tool execution completed", { toolName, durationMs });
      const routing = resolveToolOutputRouting(toolResult.result);
      params.onToolCompleted?.({
        toolName,
        args,
        source: "tool",
        result: routing.llmPayload,
      });
      const resultEvent: PersistedToolEvent = {
        type: "result",
        toolName,
        source: "tool",
        durationMs,
        resultPreview: toPreview(
          routing.mode === "end_request"
            ? routing.terminalResponse
            : routing.llmPayload,
        ),
      };
      params.onToolEvent?.(resultEvent);
      params.emitToolEvent?.("tool_result", resultEvent);
      if (routing.mode === "end_request") {
        throw new ToolTerminalResponseError(
          routing.terminalResponse || "",
          toolName,
          "tool",
        );
      }
      return routing.llmPayload;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (!(error instanceof ToolTerminalResponseError)) {
        const message = (error as Error).message;
        params.onWarn?.("Tool execution failed", {
          toolName,
          durationMs,
          error: message,
        });
        const errorEvent: PersistedToolEvent = {
          type: "error",
          toolName,
          durationMs,
          error: message,
        };
        params.onToolEvent?.(errorEvent);
        params.emitToolEvent?.("tool_error", errorEvent);
      }
      throw error;
    }
  };
}
