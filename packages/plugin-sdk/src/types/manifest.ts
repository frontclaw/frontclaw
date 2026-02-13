/**
 * Plugin Manifest Types
 * Defines the frontclaw.json schema for plugins
 */

import { z } from "zod";
import { PermissionsSchema } from "./permissions.js";

/** Plugin manifest schema */
export const PluginManifestSchema = z.object({
  /** Unique plugin identifier (kebab-case) */
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Plugin ID must be kebab-case starting with a letter",
    ),

  /** Human-readable name */
  name: z.string().min(1).max(100),

  /** Semantic version */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must be semver format (e.g., 1.0.0)"),

  /** Plugin description */
  description: z.string().optional(),

  /** Author information */
  author: z
    .object({
      name: z.string(),
      email: z.string().email().optional(),
      url: z.string().url().optional(),
    })
    .optional(),

  /** Execution priority (lower = earlier in pipeline) */
  priority: z.number().int().min(0).max(1000).default(100),

  /** Required permissions */
  permissions: PermissionsSchema,

  /** Plugin-specific configuration schema (JSON Schema) */
  configSchema: z.record(z.unknown()).optional(),

  /** Default configuration values */
  defaultConfig: z.record(z.unknown()).optional(),

  /** Entry point file (relative to plugin root) */
  main: z.string().default("index.ts"),

  /** Minimum Frontclaw version required */
  minFrontclawVersion: z.string().optional(),

  /** Tags for categorization */
  tags: z.array(z.string()).optional().default([]),

  /** Whether the plugin is enabled by default */
  enabled: z.boolean().default(true),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** Validated and loaded plugin manifest with resolved paths */
export interface LoadedPluginManifest extends PluginManifest {
  /** Absolute path to the plugin directory */
  pluginPath: string;

  /** Absolute path to the entry point */
  entryPath: string;

  /** User-provided configuration (merged with defaults) */
  config: Record<string, unknown>;
}
