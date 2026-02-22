# Frontclaw Docker Plugin Protocol (v1)

This runtime executes each plugin as an isolated Docker container and exchanges newline-delimited JSON over stdio.

## Manifest requirements

`frontclaw.json`:

```json
{
  "runtime": "docker",
  "main": "src/plugin.ts",
  "docker": {
    "image": "oven/bun:1.3.2",
    "command": ["bun", "src/plugin.ts"],
    "network": "none",
    "readOnlyRootFs": true
  },
  "permissions": {
    "network": {
      "allowed_domains": ["api.example.com"],
      "allowed_http_endpoints": ["GET https://api.example.com/v1/*"]
    },
    "state": { "enabled": true, "read": true, "write": true },
    "fs": { "read": ["data/**"], "write": ["data/output/**"] },
    "llm": {
      "can_call_provider": true,
      "allowed_providers": ["openai"],
      "allowed_models": ["gpt-4o-mini"],
      "max_tokens_per_request": 800
    }
  }
}
```

## Boot sequence

1. Plugin prints:

```json
{"type":"SANDBOX_READY"}
```

2. Host sends `INIT` envelope (single JSON line).
3. Plugin replies with RPC `RESPONSE` or `ERROR`.

## Hook calls

Host sends:

```json
{"id":"...","type":"HOOK","method":"onPromptReceived","payload":"hello","timestamp":...}
```

Plugin replies:

```json
{"id":"...","type":"RESPONSE","success":true,"result":"...","timestamp":...}
```

or

```json
{"id":"...","type":"ERROR","success":false,"error":{"code":"...","message":"..."},"timestamp":...}
```

## System calls

Plugin requests host capability:

```json
{"id":"...","type":"SYS_CALL","method":"network.fetch","payload":{"url":"https://api.example.com/v1/ping"},"timestamp":...}
```

Host enforces `frontclaw.json` permissions and returns `RESPONSE`/`ERROR`.

Supported methods:

- `network.fetch`
- `state.get|set|delete|list|clear`
- `memory.get|set|delete|list|ttl`
- `skills.invoke`
- `fs.readText|writeText|list`
- `llm.chat`
- `log`

## Recommended TypeScript DX

Use `@workspace/plugin-sdk` runtime helpers instead of writing raw readline/stdout protocol code:

```ts
import { definePlugin, serveDockerPlugin } from "@workspace/plugin-sdk";

const plugin = definePlugin({
  async getTools() {
    return [
      {
        name: "echo",
        description: "Echo text",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ];
  },
  async executeTool(_ctx, toolName, args) {
    if (toolName !== "echo") return { success: false, error: "Unknown tool" };
    return { success: true, result: { echoed: String(args.text ?? "") } };
  },
});

serveDockerPlugin(plugin);
```
