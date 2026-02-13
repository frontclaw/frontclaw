# Skills Example Plugin

Minimal plugin that exposes a single skill (`echo`).

## Skill
- `echo`
  - Input: `{ "text": "..." }`
  - Output: echoed string

## Permissions
```json
{
  "permissions": {
    "skills": ["echo"]
  }
}
```

## Example
Invoke via LLM tool calling or direct orchestration.
