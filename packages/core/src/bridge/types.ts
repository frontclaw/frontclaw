/** Logger interface for system calls */
export interface SystemLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** LLM adapter interface for plugin syscall access */
export interface LLMAdapter {
  chat(options: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
    provider?: string;
  }): Promise<{
    content: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }>;
}

/** Orchestrator methods required by syscall handler */
export interface SysCallOrchestrator {
  memoryGet: <T = unknown>(key: string) => Promise<T | null>;
  memorySet: <T = unknown>(
    key: string,
    value: T,
    options?: { ttlSeconds?: number },
  ) => Promise<void>;
  memoryDelete: (key: string) => Promise<void>;
  memoryList: (prefix?: string, options?: { limit?: number }) => Promise<string[]>;
  memoryTtl: (key: string) => Promise<number | null>;
  executeSkill: (
    skillName: string,
    args: Record<string, unknown>,
  ) => Promise<{ success: boolean; result?: unknown; error?: string }>;
}

/** System call handler dependencies */
export interface SysCallDependencies {
  logger: SystemLogger;
  llm?: LLMAdapter;
}
