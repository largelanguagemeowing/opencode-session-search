import { tool, type Plugin } from "@opencode-ai/plugin"

type SessionInfo = {
  id: string
  title: string
  directory: string
  time?: {
    updated?: number
    created?: number
  }
}

type SessionMessage = {
  info?: {
    id?: string
    role?: string
    time?: {
      created?: number
    }
  }
  parts?: Array<{
    type?: string
    text?: string
  }>
}

type SearchHit = {
  score: number
  sessionID: string
  sessionTitle: string
  directory: string
  messageID: string
  role: string
  timestamp?: number
  snippet: string
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function extractSearchableText(parts: SessionMessage["parts"]): string {
  if (!parts || parts.length === 0) {
    return ""
  }

  const textParts: string[] = []
  for (const part of parts) {
    if (!part || typeof part.text !== "string") {
      continue
    }

    if (part.type === "text" || part.type === "reasoning") {
      textParts.push(part.text)
    }
  }

  return textParts.join("\n")
}

function extractReadableText(parts: SessionMessage["parts"], includeReasoning: boolean): string {
  if (!parts || parts.length === 0) {
    return ""
  }

  const lines: string[] = []
  for (const part of parts) {
    if (!part || typeof part.text !== "string") {
      continue
    }

    if (part.type === "text") {
      lines.push(part.text)
      continue
    }

    if (includeReasoning && part.type === "reasoning") {
      lines.push(`[reasoning]\n${part.text}`)
    }
  }

  return lines.join("\n\n").trim()
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle || !haystack) {
    return 0
  }

  let count = 0
  let start = 0
  while (true) {
    const index = haystack.indexOf(needle, start)
    if (index === -1) {
      break
    }
    count += 1
    start = index + needle.length
  }
  return count
}

function makeSnippet(text: string, query: string, radius = 140): string {
  const compact = text.replace(/\s+/g, " ").trim()
  if (!compact) {
    return ""
  }

  const lowered = compact.toLowerCase()
  const queryLower = query.toLowerCase()
  const index = lowered.indexOf(queryLower)

  if (index === -1) {
    return compact.slice(0, radius * 2)
  }

  const start = Math.max(0, index - radius)
  const end = Math.min(compact.length, index + query.length + radius)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < compact.length ? "..." : ""

  return `${prefix}${compact.slice(start, end)}${suffix}`
}

function scoreMatch(sessionTitle: string, body: string, query: string, terms: string[]): number {
  const title = sessionTitle.toLowerCase()
  const content = body.toLowerCase()
  const queryLower = query.toLowerCase()

  let score = 0
  if (title.includes(queryLower)) {
    score += 8
  }

  score += countOccurrences(content, queryLower) * 5

  for (const term of terms) {
    if (term.length < 2) {
      continue
    }

    if (title.includes(term)) {
      score += 2
    }
    if (content.includes(term)) {
      score += 1
    }
  }

  return score
}

export const SessionSearchPlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      search_sessions: tool({
        description:
          "Search existing OpenCode session conversations by keyword and return matching message snippets.",
        args: {
          query: tool.schema
            .string()
            .min(2)
            .describe("Search text to find in past session titles and message content"),
          includeAllDirectories: tool.schema
            .boolean()
            .default(false)
            .describe("Search all known session directories instead of only the current one"),
          maxSessions: tool.schema
            .number()
            .int()
            .min(1)
            .max(200)
            .default(40)
            .describe("Maximum number of matched sessions to include"),
          maxMessagesPerSession: tool.schema
            .number()
            .int()
            .min(1)
            .max(1000)
            .default(250)
            .describe("Maximum messages to inspect per session"),
          maxResults: tool.schema
            .number()
            .int()
            .min(1)
            .max(50)
            .default(12)
            .describe("Maximum number of matching hits to return"),
        },
        async execute(args, context) {
          const query = args.query.trim()
          const queryLower = query.toLowerCase()
          const terms = tokenize(query)

          if (!query) {
            return "Query is empty."
          }

          context.metadata({
            title: `Search sessions: ${query}`,
            metadata: {
              query,
              includeAllDirectories: args.includeAllDirectories,
            },
          })

          const listResult = await client.session.list({
            query: args.includeAllDirectories ? {} : { directory: context.directory },
          })

          if (listResult.error || !listResult.data) {
            const reason = listResult.error ? JSON.stringify(listResult.error) : "Unknown error"
            return `Failed to list sessions: ${reason}`
          }

          const sessions = (listResult.data as SessionInfo[])
            .slice()
            .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))

          if (sessions.length === 0) {
            return "No sessions found to search."
          }

          const hits: SearchHit[] = []

          for (const session of sessions) {
            const messagesResult = await client.session.messages({
              path: { id: session.id },
              query: {
                directory: session.directory,
                limit: args.maxMessagesPerSession,
              },
            })

            if (messagesResult.error || !messagesResult.data) {
              continue
            }

            const messages = messagesResult.data as SessionMessage[]
            for (const message of messages) {
              const body = extractSearchableText(message.parts)
              if (!body) {
                continue
              }

              const searchable = `${session.title}\n${body}`.toLowerCase()
              const matched = searchable.includes(queryLower) ||
                terms.every((term) => searchable.includes(term))

              if (!matched) {
                continue
              }

              const hit: SearchHit = {
                score: scoreMatch(session.title, body, query, terms),
                sessionID: session.id,
                sessionTitle: session.title,
                directory: session.directory,
                messageID: message.info?.id ?? "unknown",
                role: message.info?.role ?? "unknown",
                timestamp: message.info?.time?.created,
                snippet: makeSnippet(body, query),
              }

              hits.push(hit)
            }
          }

          if (hits.length === 0) {
            return [
              `No matches found for \"${query}\".`,
              `Searched ${sessions.length} sessions in ${args.includeAllDirectories ? "all directories" : "the current directory"}.`,
            ].join("\n")
          }

          const rankedHits = hits
            .sort((a, b) => {
              if (b.score !== a.score) {
                return b.score - a.score
              }
              return (b.timestamp ?? 0) - (a.timestamp ?? 0)
            })

          const limitedByMatchedSessions: SearchHit[] = []
          const matchedSessionIDs = new Set<string>()
          for (const hit of rankedHits) {
            if (!matchedSessionIDs.has(hit.sessionID) && matchedSessionIDs.size >= args.maxSessions) {
              continue
            }

            matchedSessionIDs.add(hit.sessionID)
            limitedByMatchedSessions.push(hit)
          }

          const results = limitedByMatchedSessions
            .slice(0, args.maxResults)

          const lines: string[] = []
          lines.push(`Found ${hits.length} matches for \"${query}\" (showing ${results.length} from ${matchedSessionIDs.size} matched sessions).`)

          for (const [index, hit] of results.entries()) {
            const time = hit.timestamp ? new Date(hit.timestamp).toISOString() : "unknown-time"
            lines.push("")
            lines.push(`${index + 1}. [${hit.role}] ${hit.sessionTitle}`)
            lines.push(`   session: ${hit.sessionID}`)
            lines.push(`   message: ${hit.messageID}`)
            lines.push(`   directory: ${hit.directory}`)
            lines.push(`   time: ${time}`)
            lines.push(`   score: ${hit.score}`)
            lines.push(`   snippet: ${hit.snippet}`)
          }

          return lines.join("\n")
        },
      }),
      read_session: tool({
        description: "Read a session conversation by session ID and return its messages.",
        args: {
          sessionID: tool.schema
            .string()
            .min(1)
            .describe("Session ID to read"),
          maxMessages: tool.schema
            .number()
            .int()
            .min(1)
            .max(500)
            .default(200)
            .describe("Maximum number of messages to return"),
          includeReasoning: tool.schema
            .boolean()
            .default(false)
            .describe("Include reasoning parts in output"),
          maxCharsPerMessage: tool.schema
            .number()
            .int()
            .min(200)
            .max(10000)
            .default(2000)
            .describe("Maximum characters shown per message"),
        },
        async execute(args, context) {
          const sessionID = args.sessionID.trim()
          if (!sessionID) {
            return "sessionID is required."
          }

          context.metadata({
            title: `Read session: ${sessionID}`,
            metadata: { sessionID },
          })

          const listResult = await client.session.list({ query: {} })
          if (listResult.error || !listResult.data) {
            const reason = listResult.error ? JSON.stringify(listResult.error) : "Unknown error"
            return `Failed to list sessions: ${reason}`
          }

          const sessions = listResult.data as SessionInfo[]
          const session = sessions.find((item) => item.id === sessionID)
          if (!session) {
            return `Session not found: ${sessionID}`
          }

          const getResult = await client.session.get({
            path: { id: sessionID },
            query: { directory: session.directory },
          })

          if (getResult.error || !getResult.data) {
            const reason = getResult.error ? JSON.stringify(getResult.error) : "Unknown error"
            return `Failed to fetch session ${sessionID}: ${reason}`
          }

          const messagesResult = await client.session.messages({
            path: { id: sessionID },
            query: {
              directory: session.directory,
              limit: args.maxMessages,
            },
          })

          if (messagesResult.error || !messagesResult.data) {
            const reason = messagesResult.error ? JSON.stringify(messagesResult.error) : "Unknown error"
            return `Failed to fetch messages for ${sessionID}: ${reason}`
          }

          const messages = messagesResult.data as SessionMessage[]
          if (messages.length === 0) {
            return [
              `Session: ${session.title}`,
              `ID: ${session.id}`,
              `Directory: ${session.directory}`,
              "",
              "No messages found.",
            ].join("\n")
          }

          const output: string[] = []
          output.push(`Session: ${session.title}`)
          output.push(`ID: ${session.id}`)
          output.push(`Directory: ${session.directory}`)
          output.push(`Messages: ${messages.length}`)

          for (const [index, message] of messages.entries()) {
            const role = message.info?.role ?? "unknown"
            const messageID = message.info?.id ?? "unknown"
            const created = message.info?.time?.created
            const timestamp = created ? new Date(created).toISOString() : "unknown-time"
            const fullText = extractReadableText(message.parts, args.includeReasoning)
            const trimmedText = fullText.length > args.maxCharsPerMessage
              ? `${fullText.slice(0, args.maxCharsPerMessage)}...`
              : fullText

            output.push("")
            output.push(`${index + 1}. [${role}] ${timestamp}`)
            output.push(`   message: ${messageID}`)
            output.push(`   ${trimmedText || "(no text parts)"}`)
          }

          return output.join("\n")
        },
      }),
    },
  }
}

export default SessionSearchPlugin
