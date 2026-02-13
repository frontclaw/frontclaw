import type { ToolDefinition, ToolResult } from "@workspace/plugin-sdk";
import type { PluginRuntimeContext } from "../runtime-context.js";
import { parseNamespacedName } from "./namespaced.js";

export async function collectToolsPipeline(
  runtime: PluginRuntimeContext,
): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    try {
      const pluginTools = await bridge.callHook<ToolDefinition[]>(
        "getTools",
        undefined,
      );
      if (Array.isArray(pluginTools)) {
        for (const tool of pluginTools) {
          tools.push({
            ...tool,
            name: `${manifest.id}__${tool.name}`,
          });
        }
      }
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed getTools:`, error);
    }
  }

  return tools;
}

export async function executeToolPipeline(
  runtime: PluginRuntimeContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = parseNamespacedName(toolName);
  if (!parsed) {
    return {
      success: false,
      error: `Invalid tool name: ${toolName}`,
    };
  }

  const bridge = runtime.bridges.get(parsed.pluginId);
  if (!bridge) {
    return {
      success: false,
      error: `Plugin ${parsed.pluginId} not found`,
    };
  }

  try {
    const result = await bridge.callHook<ToolResult>("executeTool", {
      toolName: parsed.localName,
      args,
    });
    return result || { success: false, error: "Tool returned no result" };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}
