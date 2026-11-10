#!/usr/bin/env bun
/**
 * QQ channel for Claude Code.
 *
 * Entry point: serves the Channel to Claude Code over stdio. Stdout carries
 * the MCP stream, so everything else is written to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createChannel } from './src/channel.ts'
import { resolveStateDir } from './src/credentials.ts'
import { createSdkGateway } from './src/sdk-gateway.ts'

function log(message: string): void {
  process.stderr.write(`qq channel: ${message}\n`)
}

// Without these the process dies silently on any unhandled promise rejection.
process.on('unhandledRejection', err => log(`unhandled rejection: ${err}`))
process.on('uncaughtException', err => log(`uncaught exception: ${err}`))

const channel = createChannel({
  // QQ_CHANNEL_TRACE=1 also logs routine connection events, to troubleshoot the connection.
  gateway: createSdkGateway({ log, trace: process.env.QQ_CHANNEL_TRACE ? log : undefined }),
  stateDir: resolveStateDir(),
  log,
})

// When Claude Code closes the MCP connection, stdin gets EOF. Exit then, so
// the process does not outlive the session.
let shuttingDown = false
function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  log('shutting down')
  setTimeout(() => process.exit(0), 2000)
  void channel.stop().finally(() => process.exit(0))
}
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

await channel.start(new StdioServerTransport())
