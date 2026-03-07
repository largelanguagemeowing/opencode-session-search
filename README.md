# OpenCode Session Search Plugin

An OpenCode plugin that enables searching and retrieving session history.

## Features

- **search_sessions**: Search through all your OpenCode session conversations by keyword
- **read_session**: Read complete session conversations by session ID

## Installation

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@largelanguagemeowing/opencode-session-search@latest"]
}
```

Or for local development:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-session-search/dist/index.js"]
}
```

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

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Type check
npm run lint
```

## License

MIT
