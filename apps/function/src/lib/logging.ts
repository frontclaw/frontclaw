export type LogsMode = "debug" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";

function resolveLogsMode(): LogsMode {
  const value = (process.env.LOGS || "production").trim().toLowerCase();
  return value === "debug" ? "debug" : "production";
}

export const LOGS_MODE: LogsMode = resolveLogsMode();

function print(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  const prefix = `[${level.toUpperCase()}] [${scope}] ${message}`;
  if (meta === undefined) {
    if (level === "error") console.error(prefix);
    else if (level === "warn") console.warn(prefix);
    else if (level === "info") console.info(prefix);
    else console.debug(prefix);
    return;
  }

  if (level === "error") console.error(prefix, meta);
  else if (level === "warn") console.warn(prefix, meta);
  else if (level === "info") console.info(prefix, meta);
  else console.debug(prefix, meta);
}

export function createScopedLogger(scope: string) {
  return {
    mode: LOGS_MODE,
    debug(message: string, meta?: unknown) {
      if (LOGS_MODE !== "debug") return;
      print("debug", scope, message, meta);
    },
    info(message: string, meta?: unknown, options?: { essential?: boolean }) {
      if (LOGS_MODE !== "debug" && !options?.essential) return;
      print("info", scope, message, meta);
    },
    warn(message: string, meta?: unknown) {
      print("warn", scope, message, meta);
    },
    error(message: string, meta?: unknown) {
      print("error", scope, message, meta);
    },
  };
}

export function createPluginSystemLogger() {
  const logger = createScopedLogger("plugins");
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      logger.debug(message, meta);
    },
    info(message: string, meta?: Record<string, unknown>) {
      // Plugin info logs are very verbose; keep them in debug only.
      logger.info(message, meta);
    },
    warn(message: string, meta?: Record<string, unknown>) {
      logger.warn(message, meta);
    },
    error(message: string, meta?: Record<string, unknown>) {
      logger.error(message, meta);
    },
  };
}
