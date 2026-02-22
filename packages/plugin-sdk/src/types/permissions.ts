/**
 * Permission Types
 * Defines the security model for plugin capabilities
 */

import { z } from "zod";

/** Network/fetch permissions */
export const NetworkPermissionSchema = z.object({
  allowed_domains: z.array(z.string()).optional().default([]),
  allow_all: z.boolean().optional().default(false),
  allowed_http_endpoints: z.array(z.string()).optional().default([]),
});
export type NetworkPermission = z.infer<typeof NetworkPermissionSchema>;

/** Filesystem access permissions (plugin-local paths) */
export const FSPermissionSchema = z.object({
  read: z.array(z.string()).optional().default([]),
  write: z.array(z.string()).optional().default([]),
});
export type FSPermission = z.infer<typeof FSPermissionSchema>;

/** Plugin-local state permissions */
export const StatePermissionSchema = z.object({
  enabled: z.boolean().optional().default(true),
  read: z.boolean().optional().default(true),
  write: z.boolean().optional().default(true),
});
export type StatePermission = z.infer<typeof StatePermissionSchema>;

/** LLM interaction permissions */
export const LLMPermissionSchema = z.object({
  can_intercept_task: z.boolean().optional().default(false),
  can_modify_prompt: z.boolean().optional().default(false),
  can_modify_system_message: z.boolean().optional().default(false),
  can_modify_response: z.boolean().optional().default(false),
  max_tokens_per_request: z.number().optional(),
  can_call_provider: z.boolean().optional().default(false),
  allowed_providers: z.array(z.string()).optional().default([]),
  allowed_models: z.array(z.string()).optional().default([]),
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
  state: StatePermissionSchema.optional().default({ enabled: true }),
  network: NetworkPermissionSchema.optional(),
  fs: FSPermissionSchema.optional(),
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
