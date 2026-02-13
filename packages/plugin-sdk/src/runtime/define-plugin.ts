/**
 * Define Plugin Helper
 * Type-safe way for plugin developers to create plugins
 */

import type { FrontclawPlugin } from "../types/hooks.js";

/**
 * Helper function to define a plugin with full type safety
 *
 * @example
 * ```ts
 * import { definePlugin } from "@workspace/plugin-sdk";
 *
 * export default definePlugin({
 *   async onPromptReceived(ctx, prompt) {
 *     // Your logic here
 *     return prompt;
 *   },
 * });
 * ```
 */
export default function definePlugin<T extends FrontclawPlugin>(plugin: T): T {
  return plugin;
}
