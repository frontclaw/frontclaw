# Plugin Implementation Security Assessment

**Date:** 2026-02-15  
**Scope:** Frontclaw Plugin System Architecture

## Overall Assessment: MOSTLY PROPER ✅ with some security concerns

---

## Executive Summary

The Frontclaw plugin system demonstrates a well-architected approach to extensibility with proper sandboxing, permission-based access control, and hook-based extensibility. However, several security issues ranging from critical to medium severity need to be addressed before production deployment.

---

## What is Done Well

### 1. Sandboxing Architecture ✅

- Plugins run in isolated `Bun.Worker` threads (`sandbox.ts`)
- No direct access to host APIs - everything goes through RPC
- Clean separation via `postMessage` communication
- **Files:**
  - `/packages/plugin-sdk/src/runtime/sandbox.ts` (lines 1-357)
  - `/packages/core/src/bridge/worker-bridge.ts` (lines 1-284)

### 2. Permission System ✅

- Comprehensive permission model covering:
  - Database access (`db.tables`, `db.access`)
  - Network/fetch (`network.allowed_domains`, `network.allow_all`)
  - LLM interaction (`llm.can_modify_prompt`, `llm.can_modify_system_message`, `llm.can_intercept_task`)
  - API routes (`api.routes`, `api.methods`)
  - Socket events (`socket.can_intercept`, `socket.can_emit`, `socket.events`)
  - Skills (`skills` array with wildcard support)
  - Memory storage (`memory.read`, `memory.write`)
  - Logging (`log.enabled`, `log.levels`)
- Permission checks enforced for all system calls
- Wildcard support for flexible patterns (`*`, `prefix__*`)
- **Files:**
  - `/packages/plugin-sdk/src/types/permissions.ts` (lines 1-73)
  - `/packages/core/src/bridge/permission-guard.ts` (lines 1-351)

### 3. Hook-based Extensibility ✅

- Clean pipeline architecture:
  - Prompt pipeline: `onPromptReceived`, `transformSystemMessage`, `beforeLLMCall`, `afterLLMCall`
  - Tool pipeline: `getTools`, `executeTool`
  - Skill pipeline: `getSkills`, `executeSkill`
  - HTTP pipeline: `onHTTPRequest`
  - Socket pipeline: `onSocketConnect`, `onSocketMessage`, `onSocketDisconnect`
  - Search pipeline: `onSearch`
- Plugins can extend functionality without core modifications
- Intercept pattern allows short-circuiting pipelines
- **Files:**
  - `/packages/plugin-sdk/src/types/hooks.ts` (lines 1-236)
  - `/packages/core/src/orchestrator/pipelines/*.ts`

### 4. Namespacing ✅

- Tools and skills automatically namespaced as `{pluginId}__{name}`
- Prevents collisions between plugins
- **Files:**
  - `/packages/core/src/orchestrator/pipelines/tools.ts` (lines 21-24)
  - `/packages/core/src/orchestrator/pipelines/skills.ts`

### 5. Timeouts ✅

- Hook timeout: 5 seconds (configurable)
- System call timeout: 30 seconds
- Prevents runaway plugins from hanging the system
- **Files:**
  - `/packages/core/src/bridge/worker-bridge.ts` (lines 29-32, 179-184)

---

## Security Issues Found

### 🔴 CRITICAL: SQL Injection Risk

**Severity:** Critical  
**File:** `/packages/core/src/bridge/syscall-handler.ts` (lines 30-35)

**Issue:**

```typescript
const tableMatch = sql.match(/(?:FROM|INTO|UPDATE)\s+["']?(\w+)["']?/i);
const table = sql.match?.[1] || "*";
```

The regex-based table extraction is fragile and can be bypassed with complex SQL. Examples:

- Subqueries: `SELECT * FROM (SELECT * FROM secret_table)`
- Comments: `SELECT * FROM /* comment */ users`
- String manipulation in queries

**Impact:**

- Plugins could potentially access unauthorized tables
- Data leakage or corruption

**Recommendation:**

- Use a proper SQL parser to extract table names
- Or use prepared statement analysis
- Consider using a query builder that validates table access at parse time

**Fix Priority:** Immediate

---

### 🟠 HIGH: Missing Permission Check on `afterLLMCall`

**Severity:** High  
**File:** `/packages/core/src/orchestrator/pipelines/prompt.ts` (lines 115-136)

**Issue:**

```typescript
export async function afterLLMCallPipeline(
  runtime: PluginRuntimeContext,
  response: string,
): Promise<string> {
  let currentResponse = response;

  for (const manifest of runtime.manifests) {
    const bridge = runtime.bridges.get(manifest.id);
    if (!bridge) continue;

    // NO PERMISSION CHECK HERE!
    try {
      const result = await bridge.callHook("afterLLMCall", currentResponse);
      if (typeof result === "string") {
        currentResponse = result;
      }
    } catch (error) {
      console.error(`Plugin ${manifest.id} failed afterLLMCall:`, error);
    }
  }

  return currentResponse;
}
```

Unlike `onPromptReceived` (requires `llm.can_modify_prompt`) and `transformSystemMessage` (requires `llm.can_modify_system_message`), the `afterLLMCall` hook has **no permission check**.

**Impact:**

- Any plugin can modify LLM responses without declaring intent
- Malicious plugins could inject false information
- Security layers could be stripped from responses

**Recommendation:**

1. Add a new permission: `llm.can_modify_response`
2. Update the pipeline to check this permission before calling the hook
3. Update the permission schema in `/packages/plugin-sdk/src/types/permissions.ts`

**Fix Priority:** High

---

### 🟠 HIGH: File System Access During Plugin Import

**Severity:** High  
**File:** `/packages/plugin-sdk/src/runtime/sandbox.ts` (line 280)

**Issue:**

```typescript
async function handleInit(msg: {
  id: string;
  type: "INIT";
  entryPath: string;
  config: Record<string, unknown>;
  permissions: Permissions;
  pluginId: string;
}) {
  // ...
  // Dynamically import the plugin
  const module = await import(msg.entryPath);
  plugin = module.default || module;
  // ...
}
```

The `entryPath` is passed directly to `import()` without validation. A malicious or compromised Core could pass paths outside the plugin directory.

**Impact:**

- Arbitrary code execution from any file path
- Could load malicious code disguised as a plugin

**Recommendation:**

- Validate that `entryPath` is within the plugin's directory
- Use `path.resolve()` and check if the resolved path starts with the plugin base directory
- Consider using a file hash verification system

**Fix Priority:** High

---

### 🟡 MEDIUM: Error Stack Information Leakage

**Severity:** Medium  
**File:** `/packages/core/src/bridge/worker-bridge.ts` (lines 241-246)

**Issue:**

```typescript
this.worker!.postMessage(
  createErrorResponse(
    request.id,
    (err as any).code || "SYS_CALL_ERROR",
    err.message,
    err.stack, // <-- Stack trace exposed to plugin
  ),
);
```

Error stack traces are passed back to plugins, potentially exposing:

- Internal file paths
- Code structure
- Dependency versions

**Impact:**

- Information leakage that could aid attackers
- May reveal internal implementation details

**Recommendation:**

- Sanitize stack traces before returning to plugins
- Only expose stack traces in development mode
- Log full traces server-side, return sanitized versions to plugins

**Fix Priority:** Medium

---

### 🟡 MEDIUM: No Rate Limiting on System Calls

**Severity:** Medium  
**File:** `/packages/core/src/bridge/syscall-handler.ts` (entire file)

**Issue:**
Individual system calls don't have rate limiting. A malicious or buggy plugin could:

- Flood the database with queries
- Make excessive network requests
- Consume all memory via storage operations

**Impact:**

- Denial of Service (DoS) attacks from within sandbox
- Resource exhaustion
- Degraded performance for other plugins

**Recommendation:**

- Implement per-plugin syscall quotas (e.g., X calls per minute)
- Add circuit breakers for expensive operations
- Monitor and throttle excessive resource usage

**Fix Priority:** Medium

---

### 🟡 MEDIUM: Plugin State Not Instance-Isolated

**Severity:** Medium  
**File:** `/plugins/security-guardian/index.ts` (lines 71-80)

**Issue:**

```typescript
/** Rate limiting state */
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

/** Security statistics */
const stats = {
  totalPrompts: 0,
  blockedPrompts: 0,
  sanitizedPrompts: 0,
  injectionAttempts: 0,
  markdownViolations: 0,
};
```

Module-level state persists across plugin reloads but isn't namespaced by plugin instance. If the same plugin is loaded multiple times or reloaded, state is shared.

**Impact:**

- State pollution between plugin instances
- Potential security issues with shared rate limiting
- Statistics may be inaccurate across reloads

**Recommendation:**

- Provide plugin instance ID in context
- Use instance-scoped state containers
- Document state persistence behavior for plugin developers

**Fix Priority:** Medium

---

### 🟡 MEDIUM: HTTP Response Lack of Content Security Policy

**Severity:** Medium  
**File:** `/packages/core/src/orchestrator/pipelines/http.ts` (entire file)

**Issue:**
No Content Security Policy (CSP) headers are added to plugin HTTP responses. Plugins can return any content type without restrictions.

**Impact:**

- XSS vulnerabilities in plugin-provided endpoints
- Clickjacking risks
- Mixed content issues

**Recommendation:**

- Add default CSP headers for plugin HTTP responses
- Allow plugins to specify CSP in their manifest
- Sanitize response content types

**Fix Priority:** Medium

---

## Recommendations Summary

### Immediate Actions Required

1. **Fix SQL injection vulnerability** in `syscall-handler.ts`
2. **Add permission check** for `afterLLMCall` hook
3. **Validate import paths** in sandbox initialization

### High Priority Improvements

4. **Sanitize error stacks** before returning to plugins
5. **Implement syscall rate limiting**
6. **Add instance isolation** for plugin state
7. **Add CSP headers** for plugin HTTP responses

### Nice to Have

8. Add audit logging for security-critical operations
9. Implement plugin signature verification
10. Add resource usage metrics and alerting

---

## Architecture Strengths

The plugin system demonstrates several excellent security practices:

1. **Defense in Depth**: Multiple layers of validation (permissions, sandbox, timeouts)
2. **Principle of Least Privilege**: Plugins must explicitly declare required permissions
3. **Fail-Safe Defaults**: Missing permissions default to denied
4. **Complete Mediation**: All system calls go through the permission guard
5. **Isolation**: Worker-based sandboxing prevents direct memory access

With the identified issues addressed, this plugin system would be suitable for production use with untrusted plugins.

---

## Files Reviewed

### Core Plugin SDK

- `/packages/plugin-sdk/src/types/hooks.ts` (236 lines)
- `/packages/plugin-sdk/src/types/permissions.ts` (73 lines)
- `/packages/plugin-sdk/src/types/manifest.ts` (77 lines)
- `/packages/plugin-sdk/src/types/context.ts`
- `/packages/plugin-sdk/src/types/rpc.ts` (122 lines)
- `/packages/plugin-sdk/src/runtime/sandbox.ts` (357 lines)
- `/packages/plugin-sdk/src/runtime/define-plugin.ts` (26 lines)

### Core Bridge

- `/packages/core/src/bridge/worker-bridge.ts` (284 lines)
- `/packages/core/src/bridge/permission-guard.ts` (351 lines)
- `/packages/core/src/bridge/syscall-handler.ts` (166 lines)
- `/packages/core/src/bridge/types.ts`

### Orchestrator

- `/packages/core/src/orchestrator/orchestrator.ts` (242 lines)
- `/packages/core/src/orchestrator/pipelines/prompt.ts` (137 lines)
- `/packages/core/src/orchestrator/pipelines/tools.ts` (69 lines)
- `/packages/core/src/orchestrator/pipelines/skills.ts`
- `/packages/core/src/orchestrator/pipelines/http.ts` (36 lines)
- `/packages/core/src/orchestrator/pipelines/socket.ts`
- `/packages/core/src/orchestrator/pipelines/search.ts`

### Example Plugins

- `/plugins/security-guardian/index.ts` (322 lines)
- `/plugins/security-guardian/frontclaw.json`
- `/plugins/skills-example/index.ts`
- `/plugins/skills-example/frontclaw.json`

---

_Report generated by automated security analysis_
