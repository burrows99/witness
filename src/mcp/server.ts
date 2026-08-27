import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { run, type ProgressSink } from '../cli/index.js'
import { INSTRUCTIONS, TOOLS, argvFor } from './tools.js'

/**
 * An MCP server with no logic of its own: each tool call becomes a CLI
 * invocation, and the CLI's JSON comes straight back. The verdict an agent
 * sees here is byte-for-byte the verdict CI will produce.
 */

export interface McpServerOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  version?: string
}

export interface ToolOutcome {
  exitCode: number
  stdout: string
  stderr: string
}

/** Invoke the CLI in-process and hand back exactly what it printed. */
export async function invoke(argv: string[], options: McpServerOptions = {}, onProgress?: ProgressSink): Promise<ToolOutcome> {
  let stdout = ''
  let stderr = ''
  const exitCode = await run({
    argv,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    // Taken as events rather than drawn: the terminal rendering would land in
    // the captured string, and a redrawn line is not a notification.
    ...(onProgress ? { onProgress } : {}),
    stdout: { write: (chunk: string) => { stdout += chunk; return true } } as unknown as NodeJS.WritableStream,
    stderr: { write: (chunk: string) => { stderr += chunk; return true } } as unknown as NodeJS.WritableStream,
  })
  return { exitCode, stdout, stderr }
}

// The SDK deprecates `Server` in favour of the high-level `McpServer`, whose
// `registerTool` takes a zod shape. This adapter forwards raw JSON Schema
// straight from `TOOLS` and owns no logic of its own, which is the pass-through
// case the SDK still points `Server` at. Migrating would mean translating JSON
// Schema to zod — a change to the MCP surface, not to its strictness.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export function createServer(options: McpServerOptions = {}): Server {
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const server = new Server(
    { name: 'witness', version: options.version ?? '0.1.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = (request.params.arguments ?? {})
    let argv: string[]
    try {
      argv = argvFor(request.params.name, args)
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: (error as Error).message }],
      }
    }

    // Only when the client asked. The spec forbids notifying against a token
    // that was not in the request, so a client that did not opt in gets
    // nothing rather than notifications it has no way to route.
    const token = extra._meta?.progressToken
    const onProgress: ProgressSink | undefined = token === undefined
      ? undefined
      : (event) => {
          void extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken: token,
              progress: event.progress,
              ...(event.total === undefined ? {} : { total: event.total }),
              message: event.message,
            },
          })
        }

    const outcome = await invoke(argv, options, onProgress)
    const payload = outcome.stdout.trim() || outcome.stderr.trim()

    return {
      // A blocked gate is a *result*, not a protocol error: the agent has to
      // read the findings and act on the remedies.
      isError: outcome.exitCode === 3 || outcome.exitCode === 4,
      content: [{ type: 'text' as const, text: payload }],
      structuredContent: parseJson(payload),
      _meta: { exitCode: outcome.exitCode },
    }
  })

  return server
}

export async function startStdioServer(options: McpServerOptions = {}): Promise<void> {
  const server = createServer(options)
  await server.connect(new StdioServerTransport())
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
