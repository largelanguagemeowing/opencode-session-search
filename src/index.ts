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

type ToolState = {
  status?: string
  input?: string | Record<string, unknown>
  output?: string
  error?: string
  title?: string
}

type SessionPart = {
  type?: string
  text?: string
  tool?: string
  name?: string
  state?: ToolState
}

type SessionMessage = {
  info?: {
    id?: string
    role?: string
    time?: {
      created?: number
    }
  }
  parts?: SessionPart[]
}

type SearchHit = {
  sessionID: string
  sessionTitle: string
  directory: string
  role: string
  timestamp?: number
  snippet: string
}

type RankDoc = {
  body: string
  title?: string
  timestamp?: number
}

type RankResult = {
  index: number
  score: number
  snippet: string
}

type SearchEnvelope = {
  query: string
  totalMatches: number
  returned: number
  offset: number
  hits: SearchHit[]
}

type ReadMessage = {
  role: string
  messageID: string
  timestamp?: number
  text: string
}

type ReadEnvelope = {
  session: {
    id: string
    title: string
    directory: string
  }
  messages: ReadMessage[]
  returned: number
  nextCursor?: string
}

// v1 SDK `SessionMessagesData["query"]` omits `before` though the server accepts it.
// This augmentation is intentional — see docs/adr/0003-v1-sdk-before-type-augmentation.md
type SessionMessagesQuery = {
  directory?: string
  limit?: number
  before?: string
}

// Per-session message scan depth. An implementation detail, not agent-facing
// (see candidate 4 / ADR-0001). Matches the previous default to avoid behavior change.
const SCAN_MESSAGES_PER_SESSION = 250

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function renderToolInput(input: unknown): string {
  if (!input) return ""
  if (typeof input === "string") return truncate(input, 300)
  if (typeof input === "object") return truncate(JSON.stringify(input), 300)
  return ""
}

function renderToolResult(state: ToolState, max: number): string {
  if (typeof state.output === "string" && state.output) {
    return truncate(state.output, max)
  }
  if (typeof state.error === "string" && state.error) {
    return truncate(state.error, max)
  }
  return ""
}

function renderToolPart(part: SessionPart, maxOutputChars: number): string {
  const name = part.tool ?? part.name ?? "unknown"
  const state = part.state
  if (!state) return `[tool: ${name}]`
  const status = state.status ? ` (${state.status})` : ""
  const lines = [`[tool: ${name}]${status}`]
  const input = renderToolInput(state.input)
  if (input) lines.push(`input: ${input}`)
  const output = renderToolResult(state, maxOutputChars)
  if (output) lines.push(`→ ${output}`)
  return lines.join("\n")
}

function extractSearchableText(parts: SessionMessage["parts"]): string {
  if (!parts || parts.length === 0) {
    return ""
  }

  const textParts: string[] = []
  for (const part of parts) {
    if (!part) {
      continue
    }

    if (part.type === "text" || part.type === "reasoning") {
      if (typeof part.text === "string") {
        textParts.push(part.text)
      }
      continue
    }

    if (part.type === "tool") {
      textParts.push(renderToolPart(part, 500))
    }
  }

  return textParts.join("\n")
}

function extractReadableText(
  parts: SessionMessage["parts"],
  includeReasoning: boolean,
  maxToolOutputChars: number,
): string {
  if (!parts || parts.length === 0) {
    return ""
  }

  const lines: string[] = []
  for (const part of parts) {
    if (!part) {
      continue
    }

    if (part.type === "text") {
      if (typeof part.text === "string") {
        lines.push(part.text)
      }
      continue
    }

    if (includeReasoning && part.type === "reasoning") {
      if (typeof part.text === "string") {
        lines.push(`[reasoning]\n${part.text}`)
      }
      continue
    }

    if (part.type === "tool") {
      lines.push(renderToolPart(part, maxToolOutputChars))
    }
  }

  return lines.join("\n\n").trim()
}

// ── Ranker ──────────────────────────────────────────────────────────────
// Pure ranking module: TF-IDF + field weight (title > body) + phrase boost.
// Stateless, session-agnostic. The only seam is rank(); helpers below are
// private to it. See candidate 5.
//
// Match semantics: OR-of-terms — any query term present makes a doc a
// candidate; the score discriminates. IDF (computed over the fetched doc
// window) down-weights ubiquitous terms so flooding is bounded by ranking.

const TITLE_WEIGHT = 3
const BODY_WEIGHT = 1
const PHRASE_BOOST = 4

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

function makeSnippet(
  body: string,
  queryTerms: string[],
  idf: Map<string, number>,
  radius = 140,
): string {
  const compact = body.replace(/\s+/g, " ").trim()
  if (!compact) {
    return ""
  }
  if (queryTerms.length === 0) {
    return compact.slice(0, radius * 2)
  }

  const lowered = compact.toLowerCase()

  let bestTerm = ""
  let bestIdf = -1
  let bestIndex = -1
  for (const term of queryTerms) {
    const idx = lowered.indexOf(term)
    if (idx === -1) {
      continue
    }
    const idfVal = idf.get(term) ?? 0
    if (idfVal > bestIdf) {
      bestIdf = idfVal
      bestTerm = term
      bestIndex = idx
    }
  }

  if (bestIndex === -1) {
    return compact.slice(0, radius * 2)
  }

  const start = Math.max(0, bestIndex - radius)
  const end = Math.min(compact.length, bestIndex + bestTerm.length + radius)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < compact.length ? "..." : ""

  return `${prefix}${compact.slice(start, end)}${suffix}`
}

function rank(query: string, docs: RankDoc[]): RankResult[] {
  const queryTerms = tokenize(query)
  if (queryTerms.length === 0 || docs.length === 0) {
    return []
  }

  const queryLower = query.toLowerCase()
  const N = docs.length

  const docTokens = docs.map((d) => ({
    bodyTokens: tokenize(d.body),
    titleTokens: d.title ? tokenize(d.title) : [],
  }))

  const df = new Map<string, number>()
  for (const term of queryTerms) {
    df.set(term, 0)
  }
  for (const { bodyTokens, titleTokens } of docTokens) {
    const seen = new Set<string>()
    for (const t of bodyTokens) {
      seen.add(t)
    }
    for (const t of titleTokens) {
      seen.add(t)
    }
    for (const term of queryTerms) {
      if (seen.has(term)) {
        df.set(term, (df.get(term) ?? 0) + 1)
      }
    }
  }

  const idf = new Map<string, number>()
  for (const term of queryTerms) {
    const d = df.get(term) ?? 0
    idf.set(term, Math.log((N + 1) / (d + 1)) + 1)
  }

  const results: RankResult[] = []

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    const { bodyTokens, titleTokens } = docTokens[i]

    const tfBody = new Map<string, number>()
    for (const t of bodyTokens) {
      tfBody.set(t, (tfBody.get(t) ?? 0) + 1)
    }
    const tfTitle = new Map<string, number>()
    for (const t of titleTokens) {
      tfTitle.set(t, (tfTitle.get(t) ?? 0) + 1)
    }

    let score = 0
    let matched = false
    for (const term of queryTerms) {
      const idfVal = idf.get(term) ?? 0
      const tb = tfBody.get(term) ?? 0
      const tt = tfTitle.get(term) ?? 0
      if (tb + tt > 0) {
        matched = true
      }
      score += tb * idfVal * BODY_WEIGHT + tt * idfVal * TITLE_WEIGHT
    }

    if (!matched) {
      continue
    }

    if (queryTerms.length > 1) {
      const bodyLower = doc.body.toLowerCase()
      if (bodyLower.includes(queryLower)) {
        score += PHRASE_BOOST * BODY_WEIGHT
      }
      const titleLower = doc.title?.toLowerCase() ?? ""
      if (titleLower.includes(queryLower)) {
        score += PHRASE_BOOST * TITLE_WEIGHT
      }
    }

    results.push({
      index: i,
      score,
      snippet: makeSnippet(doc.body, queryTerms, idf),
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results
}

export const SessionSearchPlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      search_sessions: tool({
        description:
          "Search existing OpenCode session conversations by keyword and return matching message snippets as a structured JSON envelope (see ADR-0001).",
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
            .describe("Maximum number of sessions to scan (cost ceiling: one round-trip per session)"),
          maxResults: tool.schema
            .number()
            .int()
            .min(1)
            .max(50)
            .default(12)
            .describe("Maximum number of matching hits to return per page"),
          offset: tool.schema
            .number()
            .int()
            .min(0)
            .default(0)
            .describe("Number of ranked hits to skip (agent-managed pagination; increment by `returned`)"),
        },
        async execute(args, context) {
          const maxSessions = args.maxSessions ?? 40
          const maxResults = args.maxResults ?? 12
          const offset = args.offset ?? 0
          const query = args.query.trim()

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
            .slice(0, maxSessions)

          type ScanItem = {
            doc: RankDoc
            session: SessionInfo
            message: SessionMessage
          }
          const items: ScanItem[] = []

          for (const session of sessions) {
            const messagesResult = await client.session.messages({
              path: { id: session.id },
              query: {
                limit: SCAN_MESSAGES_PER_SESSION,
              },
            })

            if (messagesResult.error || !messagesResult.data) {
              continue
            }

            for (const message of messagesResult.data as SessionMessage[]) {
              const body = extractSearchableText(message.parts)
              if (!body) {
                continue
              }
              items.push({
                doc: {
                  body,
                  title: session.title,
                  timestamp: message.info?.time?.created,
                },
                session,
                message,
              })
            }
          }

          const ranked = rank(query, items.map((item) => item.doc))
          const page = ranked.slice(offset, offset + maxResults)
          const hits: SearchHit[] = page.map((r) => {
            const item = items[r.index]
            return {
              sessionID: item.session.id,
              sessionTitle: item.session.title,
              directory: item.session.directory,
              role: item.message.info?.role ?? "unknown",
              timestamp: item.message.info?.time?.created,
              snippet: r.snippet,
            }
          })

          const envelope: SearchEnvelope = {
            query,
            totalMatches: ranked.length,
            returned: hits.length,
            offset,
            hits,
          }

          return JSON.stringify(envelope)
        },
      }),
      read_session: tool({
        description:
          "Read a session conversation by session ID and return its messages as a structured JSON envelope with cursor pagination (see ADR-0001/0002/0003).",
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
            .describe("Page size (maximum messages to return per call)"),
          cursor: tool.schema
            .string()
            .min(1)
            .optional()
            .describe("Opaque pagination cursor from a previous call's `nextCursor` (omit for the first page)"),
          includeReasoning: tool.schema
            .boolean()
            .default(false)
            .describe("Include reasoning parts in each message's `text`"),
          maxCharsPerMessage: tool.schema
            .number()
            .int()
            .min(200)
            .max(10000)
            .default(2000)
            .describe("Maximum characters shown per message's `text`"),
        },
        async execute(args, context) {
          const maxMessages = args.maxMessages ?? 200
          const includeReasoning = args.includeReasoning ?? false
          const maxCharsPerMessage = args.maxCharsPerMessage ?? 2000
          const sessionID = args.sessionID.trim()
          if (!sessionID) {
            return "sessionID is required."
          }

          const cursor = args.cursor?.trim() || undefined

          context.metadata({
            title: `Read session: ${sessionID}`,
            metadata: { sessionID },
          })

          const getResult = await client.session.get({
            path: { id: sessionID },
          })

          if (getResult.error || !getResult.data) {
            const reason = getResult.error ? JSON.stringify(getResult.error) : "Unknown error"
            return `Failed to fetch session ${sessionID}: ${reason}`
          }

          const session = getResult.data as SessionInfo

          const messagesResult = await client.session.messages({
            path: { id: sessionID },
              query: {
                limit: maxMessages,
                ...(cursor ? { before: cursor } : {}),
              } as SessionMessagesQuery,
          })

          if (messagesResult.error || !messagesResult.data) {
            const reason = messagesResult.error ? JSON.stringify(messagesResult.error) : "Unknown error"
            return `Failed to fetch messages for ${sessionID}: ${reason}`
          }

          const messages = messagesResult.data as SessionMessage[]
          const nextCursor = messagesResult.response?.headers.get("X-Next-Cursor") ?? undefined

          const rendered: ReadMessage[] = messages.map((message) => {
            const fullText = extractReadableText(
              message.parts,
              includeReasoning,
              maxCharsPerMessage,
            )
            const trimmedText = fullText.length > maxCharsPerMessage
              ? `${fullText.slice(0, maxCharsPerMessage)}...`
              : fullText

            return {
              role: message.info?.role ?? "unknown",
              messageID: message.info?.id ?? "unknown",
              timestamp: message.info?.time?.created,
              text: trimmedText,
            }
          })

          const envelope: ReadEnvelope = {
            session: {
              id: session.id,
              title: session.title,
              directory: session.directory,
            },
            messages: rendered,
            returned: rendered.length,
          }

          if (nextCursor) {
            envelope.nextCursor = nextCursor
          }

          return JSON.stringify(envelope)
        },
      }),
    },
  }
}

export default SessionSearchPlugin
