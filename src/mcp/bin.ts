#!/usr/bin/env node
import { startStdioServer } from './server.js'

await startStdioServer({ cwd: process.cwd(), env: process.env })
