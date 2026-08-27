#!/usr/bin/env bash
# Drive the MCP server over stdio with a progressToken, and print the
# notifications it sends back. Used by the progress-channel plan's recording,
# and runnable on its own.
set -euo pipefail
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"verify","arguments":{"plan":"fixture-pricing","vcs":"local"},"_meta":{"progressToken":"demo"}}}' \
  | node dist/mcp/bin.js 2>/dev/null \
  | node -e '
let buf = ""
process.stdin.on("data", (c) => { buf += c })
process.stdin.on("end", () => {
  for (const line of buf.split("\n").filter(Boolean)) {
    const m = JSON.parse(line)
    if (m.method === "notifications/progress") {
      const p = m.params
      console.log(`notifications/progress  ${p.progress}/${p.total ?? "?"}  ${p.message}`)
    }
    if (m.id === 2) console.log(`\nresult: exit ${m.result?._meta?.exitCode}`)
  }
})'
