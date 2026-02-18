import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolDefinition } from "../types.js";

/**
 * Convert tool definitions to AI SDK format
 */
export function convertTools(
  tools: ToolDefinition[],
  executor?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>,
): ToolSet {
  const result: ToolSet = {};
  type ToolParam = {
    type: string;
    description?: string;
    enum?: string[];
  };

  for (const toolDef of tools) {
    const properties: Record<string, z.ZodTypeAny> = {};
    const toolParams = toolDef.parameters.properties as Record<string, ToolParam>;

    for (const [key, param] of Object.entries(toolParams)) {
      let schema: z.ZodTypeAny;

      switch (param.type) {
        case "string":
          schema = param.enum
            ? z.enum(param.enum as [string, ...string[]])
            : z.string();
          break;
        case "number":
          schema = z.number();
          break;
        case "boolean":
          schema = z.boolean();
          break;
        case "array":
          schema = z.array(z.unknown());
          break;
        case "object":
          schema = z.record(z.string(), z.unknown());
          break;
        default:
          schema = z.unknown();
      }

      if (param.description) {
        schema = schema.describe(param.description);
      }

      if (!toolDef.parameters.required?.includes(key)) {
        schema = schema.optional();
      }

      properties[key] = schema;
    }

    const definition = {
      description: toolDef.description,
      inputSchema: z.object(properties),
    };

    result[toolDef.name] = executor
      ? tool({
          ...definition,
          execute: async (args) =>
            executor(toolDef.name, args as Record<string, unknown>),
        })
      : tool(definition);
  }

  return result;
}
