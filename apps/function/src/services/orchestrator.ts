import {
  Orchestrator,
  RedisMemoryService,
  SecureMemoryService,
  type OrchestratorConfig,
} from "@workspace/core";
import { primaryActions as pDB } from "@workspace/db";
import path from "node:path";
import { createPluginSystemLogger, createScopedLogger } from "../lib/logging";

function parseKey(value: string): Buffer {
  const trimmed = value.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
  const buf = isHex ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (buf.length !== 32) {
    throw new Error("MEMORY_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  }
  return buf;
}

const memoryService = process.env.REDIS_URL
  ? new RedisMemoryService({
      url: process.env.REDIS_URL,
      namespace: process.env.MEMORY_NAMESPACE,
    })
  : undefined;

const secureMemoryService =
  memoryService && process.env.MEMORY_ENCRYPTION_KEY
    ? new SecureMemoryService(memoryService, {
        encryptionKey: parseKey(process.env.MEMORY_ENCRYPTION_KEY),
        signingKey: process.env.MEMORY_SIGNING_KEY
          ? parseKey(process.env.MEMORY_SIGNING_KEY)
          : undefined,
      })
    : memoryService;

const appLogger = createScopedLogger("orchestrator");
const pluginLogger = createPluginSystemLogger();

const orchestratorConfig: OrchestratorConfig = {
  loader: {
    pluginsDir: path.resolve(import.meta.dirname, "../../../../plugins"),
    pluginConfigs: {
      // Override plugin configs here if needed
    },
    disabledPlugins: [],
  },
  dependencies: {
    db: {
      async query(sql, params) {
        // TODO: Implement raw SQL query through Drizzle
        appLogger.debug("DB query", { sql, params });
        return { rows: [], rowCount: 0 };
      },
      async getItems(table, options) {
        if (table === "fc_items" || table === "items") {
          const items = await pDB.getItems();
          return items as unknown[];
        }
        return [];
      },
      async getItem(table, id) {
        if (table === "fc_items" || table === "items") {
          const item = await pDB.getItem(id);
          return item ? (Array.isArray(item) ? item[0] : item) : null;
        }
        return null;
      },
    },
    logger: pluginLogger,
  },
  memoryService: secureMemoryService,
  hookTimeout: 5000,
};

export const orchestrator = new Orchestrator(orchestratorConfig);

export const orchestratorReady = orchestrator
  .start()
  .then(() => {
    appLogger.info("Frontclaw Orchestrator started successfully", undefined, {
      essential: true,
    });
  })
  .catch((error) => {
    appLogger.error("Failed to start Frontclaw Orchestrator", error);
    throw error;
  });
