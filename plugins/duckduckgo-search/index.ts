import Firecrawl, { SearchData } from "@mendable/firecrawl-js";
import {
  definePlugin,
  type PluginContext,
  type ToolDefinition,
  type ToolResult,
} from "@workspace/plugin-sdk";

// TODO: create env/secret manager and use it
const firecrawl = new Firecrawl({
  apiKey: "fc-56594066db73450d9a98ceef47d872c7",
});

const TOOL_NAME = "search_web";

const toolDefinition: ToolDefinition = {
  name: TOOL_NAME,
  description:
    "Search the web via FireCrawl and return concise, LLM-ready results.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (1-10)",
      },
      region: {
        type: "string",
        description: "DuckDuckGo region code (example: us-en)",
      },
      safe_search: {
        type: "string",
        description: "Safe search mode",
        enum: ["off", "moderate", "strict"],
      },
    },
    required: ["query"],
  },
};

function parseArgs(args: Record<string, unknown>): {
  query: string;
  maxResults: number;
  region?: string;
  safeSearch: "off" | "moderate" | "strict";
} {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("Missing required argument: query");
  }

  const requestedMax =
    typeof args.max_results === "number"
      ? args.max_results
      : typeof args.max_results === "string"
        ? Number.parseInt(args.max_results, 10)
        : 5;

  const maxResults = Number.isFinite(requestedMax)
    ? Math.min(10, Math.max(1, Math.floor(requestedMax)))
    : 5;

  const region =
    typeof args.region === "string" ? args.region.trim() : undefined;

  const safeSearch =
    args.safe_search === "off" ||
    args.safe_search === "strict" ||
    args.safe_search === "moderate"
      ? args.safe_search
      : "moderate";

  return {
    query,
    maxResults,
    region: region || undefined,
    safeSearch,
  };
}

async function runDuckDuckGoSearch(
  ctx: PluginContext,
  source: "tool" | "skill",
  rawArgs: Record<string, unknown>,
): Promise<{
  query: string;
  source: "tool" | "skill";
  // instant_answer: string;
  // abstract: string;
  results: SearchData;
  // total_results: number;
}> {
  ctx.log.info("DDG search step: validate arguments", { source });
  const { query, maxResults, region, safeSearch } = parseArgs(rawArgs);


  ctx.log.info("DDG search step: call API", {
    source,
    query,
  });

  let results: SearchData;
  try {
    results = await firecrawl.search(query, {
      limit: 3,
      scrapeOptions: { formats: ["markdown"] },
    });
  } catch (error) {
    ctx.log.error("DDG search step: API request failed", {
      source,
      error,
    });
    throw new Error(`DuckDuckGo API request failed (${error})`);
  }

  ctx.log.info("DDG search step: parse API response", { source });

  ctx.log.info("DDG search step: normalize results", {
    source,
    query,
  });

  return {
    query,
    source,
    results,
  };
}

export default definePlugin({
  async onLoad(ctx) {
    ctx.log.info("DuckDuckGo Search plugin loaded", {
      tool: TOOL_NAME,
    });
  },

  async getTools(ctx) {
    ctx.log.info("DDG plugin step: expose tool", { tool: TOOL_NAME });
    return [toolDefinition];
  },

  async executeTool(ctx, toolName, args): Promise<ToolResult> {
    ctx.log.info("DDG plugin step: execute tool", { toolName });

    if (toolName !== TOOL_NAME) {
      ctx.log.warn("DDG plugin step: unknown tool", { toolName });
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
    }

    try {
      const result = await runDuckDuckGoSearch(ctx, "tool", args);
      ctx.log.info("DDG plugin step: tool execution complete", {
        toolName,
        result: result.results.web?.length,
      });
      return {
        success: true,
        result: JSON.stringify(result.results.web),
      };
    } catch (error) {
      ctx.log.error("DDG plugin step: tool execution failed", {
        toolName,
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  },
});
