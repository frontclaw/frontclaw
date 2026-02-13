# Security Guardian Plugin

Protects Frontclaw against prompt injection, enforces markdown rules, and adds basic rate limiting.

## Features
- Prompt injection detection with configurable patterns
- Markdown sanitization (HTML, images, links, header limits)
- Rate limiting (per-session placeholder)
- API endpoints for stats and config

## Endpoints
- `GET /security/stats`
- `GET /security/config`

## Config (frontclaw.json)
```json
{
  "ai_models": {},
  "plugins": {},
  "security-guardian": {
    "abuse_threshold": 0.8,
    "forbidden_patterns": ["ignore previous instructions"],
    "markdown_rules": {
      "allow_html": false,
      "max_header_level": 2,
      "block_images": true,
      "block_links": false,
      "max_code_block_lines": 100
    },
    "rate_limit": {
      "enabled": true,
      "max_requests_per_minute": 60
    }
  }
}
```

## Permissions
Defined in `frontclaw.json` for this plugin:
```json
{
  "permissions": {
    "llm": {
      "can_intercept_task": true,
      "can_modify_prompt": true,
      "can_modify_system_message": true
    },
    "api": {
      "routes": ["GET,POST /security/stats", "GET /security/config"]
    },
    "log": {
      "enabled": true,
      "levels": ["info", "warn", "error"]
    }
  }
}
```
