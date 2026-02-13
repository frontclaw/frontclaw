/** Logger interface for system calls */
export interface SystemLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Database adapter interface */
export interface DBAdapter {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  getItems(
    table: string,
    options?: {
      where?: Record<string, unknown>;
      limit?: number;
      offset?: number;
    },
  ): Promise<unknown[]>;
  getItem(table: string, id: string): Promise<unknown | null>;
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
  db: DBAdapter;
  logger: SystemLogger;
}
