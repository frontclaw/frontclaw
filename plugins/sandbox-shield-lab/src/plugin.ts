import {
  definePlugin,
  serveDockerPlugin,
  type PluginContext,
  type ToolDefinition,
  type SkillDefinition,
} from "@workspace/plugin-sdk";

type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };

type RuntimeState = {
  pluginId: string;
  initializedAt: string;
  requestCount: number;
  blockedPromptCount: number;
  toolCallCount: number;
  skillCallCount: number;
  deniedActions: number;
  eventLog: Array<{
    at: string;
    type: string;
    message: string;
    meta?: JSONValue;
  }>;
};

const PROMPT_DENY_PATTERNS = [
  "ignore previous instructions",
  "reveal system prompt",
  "developer mode",
  "jailbreak",
  "bypass safety",
];
const MAX_EVENTS = 100;
const RATE_WINDOW_MS = 30_000;
const RATE_MAX = 20;
const ALLOWED_FETCH_HOSTS = new Set(["httpbin.org", "api.duckduckgo.com"]);

const state: RuntimeState = {
  pluginId: process.env.FRONTCLAW_PLUGIN_ID || "sandbox-shield-lab",
  initializedAt: new Date().toISOString(),
  requestCount: 0,
  blockedPromptCount: 0,
  toolCallCount: 0,
  skillCallCount: 0,
  deniedActions: 0,
  eventLog: [],
};

const rate = new Map<string, { count: number; resetAt: number }>();

function addEvent(type: string, message: string, meta?: JSONValue): void {
  state.eventLog.push({ at: new Date().toISOString(), type, message, meta });
  if (state.eventLog.length > MAX_EVENTS) {
    state.eventLog.splice(0, state.eventLog.length - MAX_EVENTS);
  }
}

function checkRate(scope: string): void {
  const key = `${state.pluginId}:${scope}`;
  const now = Date.now();
  const bucket = rate.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rate.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  if (bucket.count >= RATE_MAX) {
    state.deniedActions += 1;
    throw new Error(`Rate limit exceeded for ${scope}`);
  }
  bucket.count += 1;
}

function safeUrl(raw: string): URL {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:") {
    throw new Error("Only https URLs are allowed");
  }
  if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
    throw new Error(`Domain not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

function sanitizePrompt(prompt: string): string {
  return prompt
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\b(ignore previous instructions|system prompt)\b/gi, "[redacted]")
    .trim();
}

const plugin = definePlugin({
  async onLoad(ctx) {
    state.pluginId = ctx.pluginId || state.pluginId;
    state.initializedAt = new Date().toISOString();
    addEvent("lifecycle", "onLoad");
    ctx.log.info("Sandbox Shield Lab loaded", { pluginId: state.pluginId });
  },

  async onUnload() {
    addEvent("lifecycle", "onUnload");
  },

  async onPromptReceived(_ctx, prompt) {
    checkRate("prompt");
    state.requestCount += 1;

    const lowered = prompt.toLowerCase();
    if (PROMPT_DENY_PATTERNS.some((pattern) => lowered.includes(pattern))) {
      state.blockedPromptCount += 1;
      addEvent("shield", "prompt blocked", {
        preview: prompt.slice(0, 80),
      });
      throw new Error("Prompt blocked by Sandbox Shield Lab");
    }

    return sanitizePrompt(prompt);
  },

  async getTools(ctx: PluginContext): Promise<ToolDefinition[]> {
    return [
      {
        name: "shield_fetch_json",
        description: "Fetch JSON from approved domains with guardrails",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "https URL to fetch" },
          },
          required: ["url"],
        },
      },
      {
        name: "shield_state_probe",
        description: "Write/read/list plugin-local state for diagnostics",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "State key to read/write" },
            value: { type: "string", description: "Optional value to store" },
          },
          required: ["key"],
        },
      },
    ] satisfies ToolDefinition[];
  },

  async executeTool(ctx, toolName, args) {
    checkRate("tool");
    state.requestCount += 1;
    state.toolCallCount += 1;

    if (toolName === "shield_fetch_json") {
      const parsed = safeUrl(String(args.url ?? ""));
      const response = await ctx.fetch(parsed.toString(), { method: "GET" });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep plain text
      }
      addEvent("tool", "shield_fetch_json", {
        url: parsed.toString(),
        status: response.status,
      });
      return { success: true, result: { status: response.status, body } };
    }

    if (toolName === "shield_state_probe") {
      const key = String(args.key ?? "").trim();
      if (!key) return { success: false, error: "key is required" };
      if ("value" in args && args.value !== undefined) {
        await ctx.state.set(key, args.value);
      }
      const value = await ctx.state.get(key);
      const keys = await ctx.state.list();
      addEvent("tool", "shield_state_probe", {
        key,
        hasValue: value !== null,
        keyCount: keys.length,
      });
      return { success: true, result: { key, value, keys } };
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  },

  async getSkills(ctx: PluginContext): Promise<SkillDefinition[]> {
    return [
      {
        name: "shield_summarize",
        description: "Summarize text using allowed LLM path",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to summarize" },
          },
          required: ["text"],
        },
      },
      {
        name: "shield_audit",
        description: "Return plugin security counters",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];
  },

  async executeSkill(ctx, skillName, args) {
    checkRate("skill");
    state.requestCount += 1;
    state.skillCallCount += 1;

    if (skillName === "shield_summarize") {
      const text = String(args.text ?? "").trim();
      if (!text) return { success: false, error: "text is required" };

      const result = await ctx.llm.chat({
        maxTokens: 180,
        messages: [
          {
            role: "user",
            content: `Summarize this text in 4 bullets:\n\n${text}`,
          },
        ],
      });
      addEvent("skill", "shield_summarize");
      return { success: true, result };
    }

    if (skillName === "shield_audit") {
      return {
        success: true,
        result: {
          pluginId: state.pluginId,
          initializedAt: state.initializedAt,
          requestCount: state.requestCount,
          blockedPromptCount: state.blockedPromptCount,
          toolCallCount: state.toolCallCount,
          skillCallCount: state.skillCallCount,
          deniedActions: state.deniedActions,
          events: state.eventLog.slice(-20),
        },
      };
    }

    return { success: false, error: `Unknown skill: ${skillName}` };
  },

  async onHTTPRequest(_ctx, req) {
    const methodUpper = req.method.toUpperCase();
    if (methodUpper !== "GET") {
      return {
        status: 405,
        body: { success: false, error: "Method not allowed" },
      };
    }

    if (req.path === "/shield/status") {
      return {
        status: 200,
        body: {
          success: true,
          pluginId: state.pluginId,
          initializedAt: state.initializedAt,
          requestCount: state.requestCount,
          blockedPromptCount: state.blockedPromptCount,
          deniedActions: state.deniedActions,
        },
      };
    }

    if (req.path === "/shield/events") {
      return {
        status: 200,
        body: {
          success: true,
          events: state.eventLog.slice(-50),
        },
      };
    }

    return { status: 404, body: { success: false, error: "Route not found" } };
  },
});

serveDockerPlugin(plugin);
