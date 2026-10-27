import { RTVIEvent, RTVIMessage, RTVIMessageType, messageSizeWithinLimit } from '@pipecat-ai/client-js'
import type { PipecatClient, LLMFunctionCallInProgressData, LLMFunctionCallStoppedData } from '@pipecat-ai/client-js'
import { executeParallel } from './agents/tool-executor'
import { stableArgsHash } from './agents/block-helpers'
import type { AgentRunContext } from './agent-context'
import type { ToolRegistry } from './mcp/tool-registry'
import type { PermissionMap, PermissionLevel } from './mcp/types'
import { resolveApprovalLevel, SELF_GATED_TOOLS } from '../lib/agent-approval-policy'
import { MUTATING_TOOLS } from '../lib/mutating-tools'
import type { VoiceLoopStore, VoiceLoopState } from '../stores/voiceLoopStore'
import { CallIdMap, MAX_WIRE_ID_CHARS } from '../lib/voice/call-ids'

type Client = Pick<PipecatClient, 'on' | 'off' | 'transport' | 'connected'>
export interface VoiceToolPermissions {
  categories: PermissionMap
  overrides: Record<string, PermissionLevel>
}
/**
 * What happens to one tool call, for whoever shows or records it. `id` is the
 * app's alias of the call (lib/voice/call-ids.ts), stable for its whole life.
 */
export type VoiceToolEvent =
  | { type: 'approval'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'started'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'finished'; id: string; name: string; args: Record<string, unknown>
      status: 'completed' | 'failed' | 'rejected'; result?: string; durationMs: number }

export interface VoiceToolBridgeOptions {
  client: Client
  registry: ToolRegistry
  run: AgentRunContext
  store: VoiceLoopStore
  // Both values originate in the app, never from an RTVI message.
  offeredTools: readonly string[]
  permissions: () => VoiceToolPermissions
  autonomous?: boolean
  toolTimeoutMs?: number
  /** Tools that get their own, longer limit (a screen task of several minutes). */
  toolTimeouts?: Readonly<Record<string, number>>
  /** Told about every call, in order. A throwing listener never stops a call. */
  onCall?: (event: VoiceToolEvent) => void
  /**
   * Runs after a tool has finished and before its result goes to the model.
   * The model answers the result at once, so whatever it needs for that
   * answer has to be in place by then. A failure here never holds a result back.
   */
  beforeResult?: (name: string) => Promise<void>
  /**
   * The switches of the surface, asked before every call: a sentence for the
   * model when this call may not run right now, and the level a tool has
   * under them. Both only ever narrow what the permissions allow.
   */
  refuse?: (name: string, args: Record<string, unknown>) => string | null
  narrow?: (name: string, level: PermissionLevel) => PermissionLevel
}

/**
 * The level one tool has in a voice session: the agent chat's own decision
 * (category, per-tool rule, read-only run), and on top of it a confirmation
 * for every tool that changes something, unless the session is autonomous.
 * The session uses the same function to tell the voice loop which tools may
 * wait for an approval.
 */
export function voiceToolLevel(
  name: string,
  registry: Pick<ToolRegistry, 'getToolByName'>,
  permissions: VoiceToolPermissions,
  run: Pick<AgentRunContext, 'mode' | 'execApproval' | 'readOnlyShellTurn'>,
  autonomous = false,
): PermissionLevel {
  const tool = registry.getToolByName(name)
  if (!tool) return 'blocked'
  const level = resolveApprovalLevel(name, {
    categoryLevel: permissions.categories[tool.category], override: permissions.overrides[name],
    codexMode: run.mode, execConfirm: run.execApproval?.confirmExec,
    readOnlyRun: run.readOnlyShellTurn,
    external: tool.source === 'external',
  })
  // A tool with its own gate asks per action itself; a card here would ask twice.
  if (level === 'auto' && !autonomous && MUTATING_TOOLS.has(name) && !SELF_GATED_TOOLS.has(name)) return 'confirm'
  return level
}

// Only the app executes tools. This bridge owns one session and is not reused
// after stop/disconnect. Bounded receipts prevent duplicate side effects.
/** What the model is told when the user said no. A vague failure made it try the same thing with another tool. */
export const DENIED_FOR_MODEL =
  'The user denied this tool call. Do not try it again and do not work around it with another tool. Tell the user that it was not done, and ask what they want instead.'

/** The reason a call did not complete, in words the model can act on. */
export function errorForModel(status: string, error: string | undefined): string {
  if (status === 'rejected' && (!error || error === 'User rejected tool call')) return DENIED_FOR_MODEL
  const reason = (error ?? '').trim()
  return reason ? reason.slice(0, 4000) : 'The tool did not complete.'
}

export class VoiceToolBridge {
  private readonly options: VoiceToolBridgeOptions
  private readonly generation: number
  private readonly abort = new AbortController()
  private readonly offered: Set<string>
  // Keyed by the id the voice loop sent. `ids` maps it to the alias the app
  // uses, so an id with characters outside the tame alphabet is still one call.
  private readonly receipts = new Map<string, string>()
  private readonly ids = new CallIdMap()
  private readonly calls = new Map<string, AbortController>()
  private queue: Promise<void> = Promise.resolve()
  private resolveApproval: ((approved: boolean) => void) | null = null
  private readonly parentAbort = () => this.stop()
  private readonly connected = () => this.update({ status: 'connected' })

  constructor(options: VoiceToolBridgeOptions) {
    this.options = options
    this.generation = options.store.getState().generation + 1
    options.store.setState({ generation: this.generation, error: null })
    this.offered = new Set(options.offeredTools)
    options.client.on(RTVIEvent.LLMFunctionCallInProgress, this.receive)
    options.client.on(RTVIEvent.LLMFunctionCallStopped, this.cancel)
    options.client.on(RTVIEvent.Disconnected, this.parentAbort)
    options.client.on(RTVIEvent.Connected, this.connected)
    options.run.abortSignal?.addEventListener('abort', this.parentAbort, { once: true })
    options.store.setState({ status: options.client.connected ? 'connected' : 'idle' })
    if (options.run.abortSignal?.aborted) this.stop()
  }

  answer(approved: boolean): void {
    this.resolveApproval?.(approved)
  }

  private update(state: Partial<VoiceLoopState>): void {
    if (this.options.store.getState().generation === this.generation) this.options.store.setState(state)
  }

  stop(): void {
    if (this.abort.signal.aborted) return
    this.abort.abort()
    this.resolveApproval?.(false)
    const { client, run } = this.options
    client.off(RTVIEvent.LLMFunctionCallInProgress, this.receive)
    client.off(RTVIEvent.LLMFunctionCallStopped, this.cancel)
    client.off(RTVIEvent.Disconnected, this.parentAbort)
    client.off(RTVIEvent.Connected, this.connected)
    run.abortSignal?.removeEventListener('abort', this.parentAbort)
    this.calls.clear()
    this.receipts.clear()
    this.ids.clear()
    this.update({ status: 'stopped', pendingApproval: null, currentTool: null })
  }

  private fail(): void {
    this.stop()
    this.update({ status: 'error', error: 'The voice tool session stopped safely. Start a new session to continue.' })
  }

  private cancel = (data: LLMFunctionCallStoppedData): void => {
    if (data.cancelled) this.calls.get(data.tool_call_id)?.abort()
  }

  private receive = (data: LLMFunctionCallInProgressData): void => {
    if (this.abort.signal.aborted) return
    if (!this.options.client.connected || this.options.store.getState().mode !== 'assistant') {
      this.fail()
      return
    }
    const wireId = data?.tool_call_id
    const name = data?.function_name
    const args = data?.arguments
    // Checked before an alias is handed out, so a malformed call cannot grow the map.
    if (typeof wireId !== 'string' || wireId.length === 0 || wireId.length > MAX_WIRE_ID_CHARS
      || typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(name)
      || !args || typeof args !== 'object' || Array.isArray(args)) {
      this.fail()
      return
    }
    let snapshot: Record<string, unknown>
    let fingerprint: string
    try {
      const serialized = JSON.stringify(args)
      if (new TextEncoder().encode(serialized).byteLength > 16_384) throw new Error('Oversized arguments')
      snapshot = JSON.parse(serialized) as Record<string, unknown>
      fingerprint = name + ':' + stableArgsHash(snapshot)
    } catch {
      this.fail()
      return
    }
    const prior = this.receipts.get(wireId)
    if (prior) {
      if (prior !== fingerprint) this.fail()
      return
    }
    // Never evict a receipt and allow an old mutation to run again.
    if (this.receipts.size >= 256 || this.calls.size >= 16) {
      this.fail()
      return
    }
    const id = this.ids.alias(wireId)
    if (!id) {
      this.fail()
      return
    }
    this.receipts.set(wireId, fingerprint)
    const control = new AbortController()
    this.calls.set(wireId, control)
    // One serial app queue also orders calls arriving in different RTVI events.
    this.queue = this.queue.then(() => this.execute(id, wireId, name, snapshot, control))
      .catch(() => this.fail())
  }

  private level(name: string): PermissionLevel {
    const { registry, permissions, run, autonomous } = this.options
    if (!this.offered.has(name)) return 'blocked'
    const level = voiceToolLevel(name, registry, permissions(), run, autonomous)
    return this.options.narrow ? this.options.narrow(name, level) : level
  }

  private async approve(id: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    const level = this.level(name)
    if (level === 'blocked') return false
    if (level === 'auto') return true
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        signal.removeEventListener('abort', aborted)
        this.resolveApproval = null
        this.update({ pendingApproval: null })
        resolve(approved && !signal.aborted && this.level(name) !== 'blocked')
      }
      const aborted = () => finish(false)
      this.resolveApproval = finish
      signal.addEventListener('abort', aborted, { once: true })
      this.update({ pendingApproval: { id, name, args } })
      this.tell({ type: 'approval', id, name, args })
    })
  }

  private tell(event: VoiceToolEvent): void {
    try { this.options.onCall?.(event) } catch { /* a listener must not break a tool call */ }
  }

  private async execute(id: string, wireId: string, name: string, args: Record<string, unknown>, control: AbortController): Promise<void> {
    const { registry, run, client } = this.options
    if (this.abort.signal.aborted) return
    const signal = AbortSignal.any([this.abort.signal, control.signal])
    const timeout = Math.min(600_000, Math.max(100, this.options.toolTimeouts?.[name] ?? this.options.toolTimeoutMs ?? 120_000))
    // An interim report travels as a result with the status "progress". The
    // voice loop puts it into the model's context and keeps the call open.
    const onToolProgress = (text: string) => {
      if (this.abort.signal.aborted || control.signal.aborted || !this.calls.has(wireId)) return
      const message = new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_RESULT, {
        function_name: name, tool_call_id: wireId, arguments: args,
        result: { status: 'progress', text: text.slice(0, 500) },
      })
      if (messageSizeWithinLimit(message, client.transport.maxMessageSize)) client.transport.sendMessage(message)
    }
    // The switches of the surface come first: a call they rule out is
    // answered here and never reaches an approval or the tool.
    const refusal = this.options.refuse?.(name, args) ?? null
    if (refusal) {
      this.calls.delete(wireId)
      this.tell({ type: 'started', id, name, args })
      this.tell({ type: 'finished', id, name, args, status: 'failed', result: refusal, durationMs: 0 })
      const message = new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_RESULT, {
        function_name: name, tool_call_id: wireId, arguments: args,
        result: { status: 'failed', error: refusal },
      })
      if (messageSizeWithinLimit(message, client.transport.maxMessageSize)) client.transport.sendMessage(message)
      return
    }
    // Named, so whoever ends with the call can tell "out of time" from "stopped".
    const timer = setTimeout(() => control.abort(new DOMException('The tool call ran out of time.', 'TimeoutError')), timeout)
    this.update({ currentTool: name })
    let approvalLevel: PermissionLevel = 'blocked'
    // The time the tool itself ran, as the chat counts it: from dispatch, so
    // without the wait for an approval, to its result.
    let began = 0
    let ended = 0
    let outcome: Extract<VoiceToolEvent, { type: 'finished' }> = { type: 'finished', id, name, args, status: 'failed', durationMs: 0 }
    try {
      const [result] = await executeParallel([{ id, toolName: name, args, run: { ...run, abortSignal: signal, onToolProgress } }], {
        getTool: (toolName) => this.offered.has(toolName) ? registry.getToolByName(toolName) : undefined,
        awaitApproval: (request) => {
          approvalLevel = this.level(name)
          return this.approve(id, name, request.args, signal)
        },
        execute: async (toolName, validatedArgs, context) => {
          const current = this.level(toolName)
          if (signal.aborted || current === 'blocked' || (current === 'confirm' && approvalLevel !== 'confirm')) {
            return 'Error: Tool permission changed before dispatch.'
          }
          this.tell({ type: 'started', id, name, args })
          began = Date.now()
          return registry.execute(toolName, validatedArgs, 0, context, signal)
        },
      }, { abortSignal: signal })
      ended = Date.now()
      outcome = {
        ...outcome,
        status: result.status === 'cached' ? 'completed' : result.status,
        result: result.status === 'completed' || result.status === 'cached' ? result.result ?? '' : result.error,
      }
      try { await this.options.beforeResult?.(name) } catch { /* the result goes out either way */ }
      if (!this.abort.signal.aborted) {
        const message = new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_RESULT, {
          // Back under the id the voice loop knows the call by.
          function_name: name, tool_call_id: wireId, arguments: args,
          result: result.status === 'completed'
            ? { status: 'completed', text: (result.result ?? '').slice(0, 65_536), truncated: (result.result?.length ?? 0) > 65_536 }
            : { status: result.status, error: errorForModel(result.status, result.error) },
        })
        if (!messageSizeWithinLimit(message, client.transport.maxMessageSize)) {
          this.fail()
          return
        }
        client.transport.sendMessage(message)
      }
    } finally {
      clearTimeout(timer)
      this.calls.delete(wireId)
      this.update({ currentTool: null })
      this.tell({ ...outcome, durationMs: began ? (ended || Date.now()) - began : 0 })
    }
  }
}
