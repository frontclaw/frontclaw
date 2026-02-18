/**
 * Permission Types
 * Defines the security model for plugin capabilities
 */

import { z } from "zod";

/** Database access permissions */
export const DBPermissionSchema = z.object({
  tables: z.array(z.string()),
  access: z.enum(["read-only", "read-write"]),
});
export type DBPermission = z.infer<typeof DBPermissionSchema>;

/** Network/fetch permissions */
export const NetworkPermissionSchema = z.object({
  allowed_domains: z.array(z.string()),
  allow_all: z.boolean().optional().default(false),
});
export type NetworkPermission = z.infer<typeof NetworkPermissionSchema>;

/** LLM interaction permissions */
export const LLMPermissionSchema = z.object({
  can_intercept_task: z.boolean().optional().default(false),
  can_modify_prompt: z.boolean().optional().default(false),
  can_modify_system_message: z.boolean().optional().default(false),
  can_modify_response: z.boolean().optional().default(false),
  max_tokens_per_request: z.number().optional(),
});
export type LLMPermission = z.infer<typeof LLMPermissionSchema>;

/** API route permissions */
export const APIPermissionSchema = z.object({
  routes: z.array(z.string()),
  methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])).optional(),
});
export type APIPermission = z.infer<typeof APIPermissionSchema>;

/** Socket event permissions */
export const SocketPermissionSchema = z.object({
  can_intercept: z.boolean().optional().default(false),
  events: z.array(z.string()).optional().default([]),
  can_emit: z.boolean().optional().default(false),
});
export type SocketPermission = z.infer<typeof SocketPermissionSchema>;

/** Logging permissions */
export const LogPermissionSchema = z.object({
  enabled: z.boolean().optional().default(true),
  levels: z
    .array(z.enum(["debug", "info", "warn", "error"]))
    .optional()
    .default(["info", "warn", "error"]),
});
export type LogPermission = z.infer<typeof LogPermissionSchema>;

/** Complete permissions object */
export const PermissionsSchema = z.object({
  db: DBPermissionSchema.optional(),
  network: NetworkPermissionSchema.optional(),
  llm: LLMPermissionSchema.optional(),
  api: APIPermissionSchema.optional(),
  socket: SocketPermissionSchema.optional(),
  skills: z.array(z.string()).optional(),
  memory: z
    .object({
      read: z.array(z.string()).optional(),
      write: z.array(z.string()).optional(),
    })
    .optional(),
  log: LogPermissionSchema.optional().default({ enabled: true }),
});
export type Permissions = z.infer<typeof PermissionsSchema>;
