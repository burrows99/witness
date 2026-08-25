/**
 * @witness/probe-dap — non-suspending observation via DAP logpoints.
 *
 * The spec is explicit that when `logMessage` is set the adapter must log
 * rather than break. That is what makes "observe state over the lifetime of
 * a request" possible at all: you cannot suspend a server mid-request and
 * still observe the request (TDD §7.3).
 */
export * from './protocol.js'
export * from './client.js'
export * from './logpoint.js'
export * from './evalerror.js'
export * from './pathmap.js'
export * from './session.js'
export * from './adapters.js'
export * from './runner.js'
