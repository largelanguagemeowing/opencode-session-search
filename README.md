# OpenCode Session Search Plugin

An OpenCode plugin for searching and reading past session history.

- `search_sessions` finds relevant conversations by keyword
- `read_session` reads a session by ID

## Installation

Install from the latest tagged GitHub release:

```bash
curl -fsSL https://raw.githubusercontent.com/largelanguagemeowing/opencode-session-search/main/scripts/install.sh | bash
```

Or install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/largelanguagemeowing/opencode-session-search/main/scripts/install.sh | bash -s -- --version v1.0.2
```

The installer downloads the release archive, installs `session-search.js` into `~/.config/opencode/plugins/`, and ensures `~/.config/opencode/package.json` includes `@opencode-ai/plugin` for local plugin dependencies.

No `opencode.json` or `opencode.jsonc` edit is required for the global local-plugin install path.

## Tools

### search_sessions

Search existing OpenCode session conversations by keyword and return matching message snippets.

**Parameters:**
- `query` (required): Search text to find in past session titles and message content
- `includeAllDirectories` (optional): Search all known session directories instead of only the current one (default: false)
- `maxSessions` (optional): Maximum number of matched sessions to include (default: 40)
- `maxMessagesPerSession` (optional): Maximum messages to inspect per session (default: 250)
- `maxResults` (optional): Maximum number of matching hits to return (default: 12)

### read_session

Read a session conversation by session ID and return its messages.

**Parameters:**
- `sessionID` (required): Session ID to read
- `maxMessages` (optional): Maximum number of messages to return (default: 200)
- `includeReasoning` (optional): Include reasoning parts in output (default: false)
- `maxCharsPerMessage` (optional): Maximum characters shown per message (default: 2000)

## Development

For local development:

```bash
npm install
npm run build
npm run lint
```

## License

MIT
