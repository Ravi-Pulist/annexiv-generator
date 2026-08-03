# MCP Server Catalog

Pre-configured MCP server setups for extending agent capabilities. Copy the config you need into your project's `.claude/settings.json` under the `mcpServers` key.

## Available Configurations

| Config | Purpose | Used By | Requires |
|--------|---------|---------|----------|
| github.json | GitHub API — PRs, issues, repos | Quinn, Kai, Ravi | `GITHUB_TOKEN` env var |
| database.json | Database schema exploration, queries | Anya | DB connection string |
| browser.json | Browser automation for E2E testing | Tara | npx @anthropic-ai/mcp-server-puppeteer |
| filesystem.json | Extended filesystem operations | All agents | npx @anthropic-ai/mcp-server-filesystem |
| slack.json | Slack messaging for notifications | Derek, Ravi | `SLACK_BOT_TOKEN` env var |
| linear.json | Linear issue tracking | Nadia, Derek | `LINEAR_API_KEY` env var |
| memory.json | Persistent memory/knowledge base | Atlas, Rex | npx @anthropic-ai/mcp-server-memory |

## How to Use

1. Choose the MCP servers your project needs
2. Copy the relevant config into `.claude/settings.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

3. Ensure required environment variables are set
4. Restart Claude Code to pick up the new MCP servers

## Agent-MCP Mapping

| Agent | Recommended MCP Servers |
|-------|------------------------|
| Atlas | memory, filesystem |
| Maya | linear (requirements from tickets) |
| Winston | github (architecture PRs), filesystem |
| Nadia | linear (roadmap, tickets) |
| Derek | linear (sprint tickets), slack (standups) |
| Soren | github (PRs), database (schema) |
| Milo | github (PRs), browser (visual testing) |
| Lena | database (integration schemas) |
| Anya | database (schema exploration, queries) |
| Ravi | github (CI/CD), slack (deploy notifications) |
| Quinn | github (PR review comments) |
| Tara | browser (E2E testing), filesystem |
| Vera | filesystem (audit evidence) |
| Kai | github (security scanning) |
| Rex | memory (research persistence) |
| Sage | filesystem (doc generation) |
