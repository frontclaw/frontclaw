# Frontclaw Plugin Flow

This document explains how the plugin runtime works today (Docker-only), using the `echo` tool as the reference flow.

## 1) Runtime model

- Each plugin runs in its own Docker container.
- Host and plugin communicate via newline-delimited JSON over `stdin/stdout`.
- Plugin code should use `@workspace/plugin-sdk` and call `serveDockerPlugin(plugin)`.
- Plugin capabilities are controlled by `permissions` in `frontclaw.json`.

## 2) Boot and handshake

1. Core loads plugin manifest (`frontclaw.json`) and starts a container.
2. Plugin process starts and immediately writes:
```json
{"type":"SANDBOX_READY"}
```
3. Core sends an `INIT` message with plugin config/permissions.
4. Plugin SDK handles `INIT`, runs `onLoad` if present, and replies `RESPONSE`.
5. Plugin is now active and available for hooks.

## 3) Echo tool registration flow

Example plugin (`src/plugin.ts`):

```ts
import { definePlugin, serveDockerPlugin } from "@workspace/plugin-sdk";

const plugin = definePlugin({
  async getTools() {
    return [
      {
        name: "echo",
        description: "Echo input text",
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

Registration behavior:

1. Core calls plugin hook `getTools`.
2. Plugin returns `[{ name: "echo", ... }]`.
3. Core namespaces tool names as `<pluginId>__<toolName>`.
4. Final tool exposed to the LLM is, for example: `newplug__echo`.

## 4) Echo execution flow

When the model calls `newplug__echo`:

1. Core parses `newplug__echo` into:
   - `pluginId = "newplug"`
   - `localToolName = "echo"`
2. Core sends HOOK request:
```json
{
  "id": "...",
  "type": "HOOK",
  "method": "executeTool",
  "payload": { "toolName": "echo", "args": { "text": "hello" } }
}
```
3. Plugin SDK dispatches to `executeTool(ctx, "echo", { text: "hello" })`.
4. Plugin returns:
```json
{
  "success": true,
  "result": { "echoed": "hello" }
}
```
5. SDK wraps that as RPC `RESPONSE` and sends to host.
6. Core forwards tool result back into the LLM tool-calling loop.

## 5) Syscalls during tool execution

Inside `executeTool`, plugin can use context APIs:

- `ctx.fetch(...)` -> `network.fetch` syscall (permission-gated)
- `ctx.state.get/set/delete/list/clear` -> plugin-scoped persistent state
- `ctx.memory.*` -> ephemeral namespaced memory
- `ctx.fs.*` -> file operations within allowed paths
- `ctx.llm.chat(...)` -> provider/model/token-gated LLM call
- `ctx.skills.invoke(...)` -> call namespaced skills
- `ctx.log.*` -> structured host logging

If a syscall is not allowed by `frontclaw.json`, host returns RPC `ERROR` and the SDK throws in plugin code.

## 6) State isolation model

- `state` is per-plugin.
- Plugin state keys are isolated by host-side namespacing (`state:<pluginId>:...` internally).
- A plugin can read/write only its own state, not core state and not another plugin's state.

## 7) Failure behavior

- If plugin never sends `SANDBOX_READY`, startup times out.
- If container exits before ready, plugin is marked failed.
- Hook timeouts return tool errors to orchestrator.
- Syscall failures are returned as RPC `ERROR` with a code/message.

## 8) Minimal checklist for plugin authors

1. Set `runtime: "docker"` in `frontclaw.json`.
2. Define strict permissions in `frontclaw.json` (only what plugin needs).
3. Implement plugin with `definePlugin(...)`.
4. Start runtime with `serveDockerPlugin(plugin)`.
5. Expose tools in `getTools`, implement behavior in `executeTool`.

