# Sandbox Shield Lab

A test plugin for validating Frontclaw Docker-sandboxed plugin capabilities and security shields.

## Runtime

- runtime: `docker`
- entrypoint: `dist/plugin.js`

## Features

- Tool: `shield_fetch_json` (strict HTTPS + host allowlist)
- Tool: `shield_state_probe` (plugin-local state read/write/list)
- Skill: `shield_summarize` (uses `llm.chat` with token cap)
- Skill: `shield_audit` (returns counters + security events)
- Prompt shield: blocks dangerous prompt-injection patterns and sanitizes unsafe text
- HTTP routes:
  - `GET /shield/status`
  - `GET /shield/events`

## Next steps

1. Ensure Docker is running.
2. Run `bun run build` in this plugin directory.
3. Set `enabled` to `true` in `frontclaw.json`.
4. Restart Frontclaw and test:
   - tool `shield_fetch_json`
   - skill `shield_audit`
   - route `/api/v1/p/sandbox-shield-lab/shield/status`
