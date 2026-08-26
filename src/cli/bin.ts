#!/usr/bin/env node
import { run } from './main.js'

const code = await run({ argv: process.argv.slice(2) })
process.exit(code)
