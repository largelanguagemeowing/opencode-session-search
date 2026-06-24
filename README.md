# OpenCode Session Search Plugin

An OpenCode plugin that adds agent-callable tools for inspecting past OpenCode sessions. Both tools return structured JSON envelopes for reliable agent-side parsing.

- `search_sessions` lets the agent find relevant conversations by keyword
- `read_session` lets the agent read a session by ID

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

Search existing OpenCode session conversations by keyword and return matching hits as a structured JSON envelope.

**Parameters:**
- `query` (required): Search text to find in past session titles and message content
- `includeAllDirectories` (optional): Search all known session directories instead of only the current one (default: false)
- `maxSessions` (optional): Maximum number of sessions to scan (cost ceiling: one round-trip per session) (default: 40)
- `maxResults` (optional): Maximum number of matching hits to return per page (default: 12)
- `offset` (optional): Number of ranked hits to skip (agent-managed pagination; increment by `returned`) (default: 0)

**Returns:** `SearchEnvelope` — `{ query, totalMatches, returned, offset, hits: [{ sessionID, sessionTitle, directory, role, timestamp, snippet }] }`

### read_session

Read a session conversation by session ID and return its messages as a structured JSON envelope with cursor pagination.

**Parameters:**
- `sessionID` (required): Session ID to read
- `maxMessages` (optional): Page size (maximum messages to return per call) (default: 200)
- `cursor` (optional): Opaque pagination cursor from a previous call's `nextCursor` (omit for the first page)
- `includeReasoning` (optional): Include reasoning parts in each message's `text` (default: false)
- `maxCharsPerMessage` (optional): Maximum characters shown per message's `text` (default: 2000)

**Returns:** `ReadEnvelope` — `{ session: { id, title, directory }, messages: [{ role, messageID, timestamp, text }], returned, nextCursor? }`

## Development

For local development:

```bash
npm install
npm run build
npm run lint
```

## License

MIT
