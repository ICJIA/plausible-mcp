# @icjia/plausible-mcp

Lightweight MCP server that queries a self-hosted [Plausible Analytics](https://plausible.io/) instance and returns compressed, actionable results optimized for Claude's context window.

Built for [ICJIA](https://icjia.illinois.gov)'s 15+ state agency web properties monitored under a single Plausible CE instance at `plausible.icjia.cloud`.

## Features

- **6 tools** — overview, pages, breakdown, timeseries, site discovery, health check
- **Compressed output** — structured plain text, 10-300 tokens per query instead of raw JSON
- **Computed deltas** — period-over-period comparison on every overview query
- **Filters** — human-readable syntax: `"page contains /grants"`, `"source is Google"`
- **Security-first** — 12-layer security model including input validation, output sanitization, rate limiting, SSRF prevention, and prompt injection defense
- **90s response cache** — reduces API load during iterative analysis
- **Zero build step** — plain JavaScript ES modules, ships as-is to npm

## Requirements

- **Node.js >= 22** (see `.nvmrc`)
- A self-hosted **Plausible CE** instance with the **v2 Query API** (introduced ~2024)
- A **Plausible API key** with Stats API scope

### Getting your Plausible API key

1. Log into your Plausible instance (e.g., `https://plausible.icjia.cloud`)
2. Go to **Settings** (your user settings, not site settings)
3. Scroll down to **API Keys**
4. Click **+ New API Key**
5. Give it a name like "MCP Server"
6. Copy the key — you'll need it for configuration below

> Your Plausible instance uses a single API key that covers all sites. There are no per-site keys.

---

## Setup

### Claude Code (terminal / CLI)

This is the easiest way to get started. Run this single command:

```bash
claude mcp add plausible-mcp -s user \
  -e PLAUSIBLE_BASE_URL=https://plausible.icjia.cloud \
  -e PLAUSIBLE_API_KEY=your-api-key-here \
  -e PLAUSIBLE_DEFAULT_SITE=icjia.illinois.gov \
  -- npx -y @icjia/plausible-mcp
```

Replace:
- `https://plausible.icjia.cloud` with your Plausible instance URL
- `your-api-key-here` with your actual API key
- `icjia.illinois.gov` with your most-used site domain (optional but recommended)

To verify it worked:

```bash
claude mcp list
```

You should see `plausible-mcp` in the list. Then in a Claude Code session, ask:

> "What's the status of my Plausible connection?"

Claude will call the `get_status` tool and confirm connectivity.

---

### Claude Code (Desktop App / claude.ai/code)

If you're using the Claude Code desktop app or web app, add the server through **Settings > MCP Servers** or edit your Claude Code config file directly.

**Config file location:**
- macOS: `~/.claude/settings.json`
- Windows: `%USERPROFILE%\.claude\settings.json`
- Linux: `~/.claude/settings.json`

Add this to your `settings.json`:

```json
{
  "mcpServers": {
    "plausible-mcp": {
      "command": "npx",
      "args": ["-y", "@icjia/plausible-mcp"],
      "env": {
        "PLAUSIBLE_BASE_URL": "https://plausible.icjia.cloud",
        "PLAUSIBLE_API_KEY": "your-api-key-here",
        "PLAUSIBLE_DEFAULT_SITE": "icjia.illinois.gov"
      }
    }
  }
}
```

> If you already have other MCP servers configured, add the `"plausible-mcp"` block inside the existing `"mcpServers"` object — don't create a second one.

---

### Cursor

Open Cursor's MCP settings:

1. Open **Cursor Settings** (Cmd+Shift+P → "Cursor Settings" or Cursor > Settings > Cursor Settings)
2. Click **MCP** in the left sidebar
3. Click **+ Add new MCP server**
4. Enter:
   - **Name:** `plausible-mcp`
   - **Type:** `command`
   - **Command:** `npx -y @icjia/plausible-mcp`

Then add the environment variables. You can also edit the config file directly:

**Config file location:**
- macOS: `~/.cursor/mcp.json`
- Windows: `%USERPROFILE%\.cursor\mcp.json`
- Linux: `~/.cursor/mcp.json`

```json
{
  "mcpServers": {
    "plausible-mcp": {
      "command": "npx",
      "args": ["-y", "@icjia/plausible-mcp"],
      "env": {
        "PLAUSIBLE_BASE_URL": "https://plausible.icjia.cloud",
        "PLAUSIBLE_API_KEY": "your-api-key-here",
        "PLAUSIBLE_DEFAULT_SITE": "icjia.illinois.gov"
      }
    }
  }
}
```

---

### VS Code (Copilot / Continue / other MCP clients)

Most VS Code MCP extensions use a `.vscode/mcp.json` file in your project root, or a global settings file.

**Project-level** — create `.vscode/mcp.json`:

```json
{
  "servers": {
    "plausible-mcp": {
      "command": "npx",
      "args": ["-y", "@icjia/plausible-mcp"],
      "env": {
        "PLAUSIBLE_BASE_URL": "https://plausible.icjia.cloud",
        "PLAUSIBLE_API_KEY": "your-api-key-here",
        "PLAUSIBLE_DEFAULT_SITE": "icjia.illinois.gov"
      }
    }
  }
}
```

---

### Windsurf

Windsurf uses a `~/.windsurf/mcp.json` config file:

```json
{
  "mcpServers": {
    "plausible-mcp": {
      "command": "npx",
      "args": ["-y", "@icjia/plausible-mcp"],
      "env": {
        "PLAUSIBLE_BASE_URL": "https://plausible.icjia.cloud",
        "PLAUSIBLE_API_KEY": "your-api-key-here",
        "PLAUSIBLE_DEFAULT_SITE": "icjia.illinois.gov"
      }
    }
  }
}
```

---

### Any MCP-compatible client

The server uses **stdio transport** (standard input/output). Any MCP client that can spawn a process and communicate via JSON-RPC over stdio will work. The configuration is always the same:

- **Command:** `npx`
- **Args:** `["-y", "@icjia/plausible-mcp"]`
- **Environment variables:**

| Variable | Required | Description |
|---|---|---|
| `PLAUSIBLE_BASE_URL` | **Yes** | Your Plausible instance URL (e.g., `https://plausible.icjia.cloud`) |
| `PLAUSIBLE_API_KEY` | **Yes** | Your Plausible Stats API key |
| `PLAUSIBLE_DEFAULT_SITE` | No | Default site domain so you don't have to specify it every query |

---

## Tools

Once configured, your AI assistant will have access to these 6 tools:

| Tool | Purpose | Example question |
|---|---|---|
| `query_overview` | Aggregate stats with computed deltas | "How's icjia.illinois.gov doing?" |
| `query_pages` | Top or bottom pages by any metric | "What pages get the most traffic?" |
| `query_breakdown` | Traffic by source, country, device, etc. | "Where's our traffic coming from?" |
| `query_timeseries` | Trends over time | "Is traffic going up or down?" |
| `list_sites` | Discover all sites on the instance | "What sites are we tracking?" |
| `get_status` | Server version + connectivity check | "Is the Plausible connection working?" |

### Example output

```
icjia.illinois.gov [30d] Vis:12.4K(+8%) Sess:15.8K(+3%) PV:42.1K(-2%) Bounce:58.3%(+1.2pp) Dur:2m14s(+12%)
```

### Filters

All query tools support a human-readable filter string:

- `"page contains /grants"` — pages with /grants in the path
- `"source is Google"` — traffic from Google only
- `"device is Mobile"` — mobile visitors only
- `"country is US"` — US visitors only
- `"page is_not /"` — exclude the homepage
- `"source contains_not Direct"` — exclude direct traffic

---

## CLI

All tools are also available as standalone CLI commands (useful for scripting or testing):

```bash
# Set env vars first
export PLAUSIBLE_BASE_URL=https://plausible.icjia.cloud
export PLAUSIBLE_API_KEY=your-api-key-here

# Then run commands
npx @icjia/plausible-mcp overview icjia.illinois.gov
npx @icjia/plausible-mcp pages icjia.illinois.gov --sort asc --limit 5
npx @icjia/plausible-mcp breakdown icjia.illinois.gov --dimension visit:source
npx @icjia/plausible-mcp timeseries icjia.illinois.gov --period 6mo
npx @icjia/plausible-mcp list-sites
npx @icjia/plausible-mcp status
```

Running without a subcommand starts the MCP server (stdio mode).

---

## Security

12-layer security model. See [docs/doc-00-master-design.md](docs/doc-00-master-design.md) for full details.

1. **Input validation** — allowlists and length caps on all parameters
2. **Output sanitization** — prompt injection prevention on all Plausible-sourced strings
3. **Rate limiting** — 600/hr, 3 concurrent, 15s timeout
4. **Response safety** — 5MB body cap, schema validation
5. **Error sanitization** — actionable messages, no key leakage
6. **Base URL validation** — SSRF prevention
7. **Content-Type validation** — catches DNS rebinding / proxy misconfiguration
8. **Cache integrity** — only validated responses cached
9. **Static code constraints** — no eval, no dynamic import
10. **API key protection** — masked everywhere, never in output
11. **Dependency pinning** — exact versions, lockfile committed
12. **Transport isolation** — stdio only, no open ports

---

## Troubleshooting

### "Authentication failed"
Your API key is wrong or missing. Double-check `PLAUSIBLE_API_KEY`.

### "Endpoint not found (404)"
Your Plausible instance may not support the v2 Query API. Update Plausible CE to a 2024+ release.

### "Cannot connect to Plausible"
Check that `PLAUSIBLE_BASE_URL` is correct and the instance is running. Try opening the URL in a browser.

### "Sites API not available (403)"
The `list_sites` tool requires the Sites API scope. Other tools will still work. You can list your sites manually.

### Server not showing up in Claude Code
Run `claude mcp list` to verify registration. If missing, re-run the `claude mcp add` command.

---

## Development

```bash
git clone https://github.com/ICJIA/plausible-mcp.git
cd plausible-mcp
nvm use
npm install
npm test
```

## License

MIT - see [LICENSE](LICENSE).
