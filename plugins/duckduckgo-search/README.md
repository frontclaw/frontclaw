# DuckDuckGo Search Plugin

Provides both:
- Tool: `search_web`
- Skill: `web_search`

Both call DuckDuckGo Instant Answer API and return structured search results.

## Why this injects results back to LLM

In Frontclaw's chat flow, tool execution result is returned by `toolExecutor` and fed back into the model by AI SDK tool-calling. This plugin returns normalized JSON specifically for that loop.

## Input

```json
{
  "query": "latest bun runtime",
  "max_results": 5,
  "region": "us-en",
  "safe_search": "moderate"
}
```

## Output

```json
{
  "query": "latest bun runtime",
  "source": "tool",
  "instant_answer": "",
  "abstract": "",
  "results": [
    {
      "title": "...",
      "snippet": "...",
      "url": "https://..."
    }
  ],
  "total_results": 5
}
```

## Permissions

```json
{
  "network": {
    "allowed_domains": ["api.duckduckgo.com"],
    "allow_all": false
  },
  "skills": ["web_search"]
}
```
