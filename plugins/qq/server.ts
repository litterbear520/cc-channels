#!/usr/bin/env bun
/**
 * QQ channel for Claude Code.
 *
 * Entry point: serves the Channel to Claude Code over stdio. Stdout carries
 * the MCP stream, so everything else is written to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createChannel } from './src/channel.ts'
import type { QQGateway } from './src/gateway.ts'

function log(message: string): void {
  process.stderr.write(`qq channel: ${message}\n`)
}

// Without these the process dies silently on any unhandled promise rejection.
process.on('unhandledRejection', err => log(`unhandled rejection: ${err}`))
process.on('uncaughtException', err => log(`uncaught exception: ${err}`))

// Stands in until the real QQ gateway exists. The Channel registers with
// Claude Code but stays disconnected from QQ.
const notConnected: QQGateway = {
  async connect() {
    log('loaded, but this version does not connect to QQ yet')
  },
  async close() {},
}

const channel = createChannel({ gateway: notConnected })

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
