# @workspace/cli

Universal Frontclaw CLI package.

## Commands

### Create a new plugin

```bash
frontclaw new plugin --name "My Plugin"
```

Options:

- `--name <name>` required
- `--id <id>` optional kebab-case plugin id
- `--path <path>` optional base plugins dir (default: `~/.frontclaw/plugins`)
  - pass `.` to scaffold in the current directory
- `--description <text>` optional description
- `--author <name>` optional author (default: `Frontclaw Team`)
- `--runtime <runtime>` currently only `docker`
- `--enable` set plugin enabled=true
- `--force` overwrite existing plugin directory
