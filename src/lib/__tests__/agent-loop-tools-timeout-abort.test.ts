/**
 * klaerung-n5a, Frage 1, Fix 2: wenn der JS-Werkzeug-Deckel (tool-timeout.ts)
 * doch einmal zuschlaegt, oder der Nutzer waehrenddessen Stop drueckt, darf
 * der verlierende Lauf nicht mehr verwaist weiterlaufen und seine lokale
 * Spur besetzt halten. Vorher tat er das: `Promise.race` ignoriert seinen
 * Verlierer nur, es bricht ihn nie ab.
 *
 * Diese Datei prueft die beiden Werkzeuge mit eigener Spur-Belegung, fuer
 * die tool-timeout.ts inzwischen KEINEN erreichbaren Deckel mehr setzt
 * (`delegate_task` im Vordergrund, `run_workflow`): dass das Signal, das
 * `raceWithToolTimeout` bei einem Abbruch abbricht (Timeout ODER Stop), auch
 * wirklich bis in ihren jeweiligen Lauf durchgereicht wird und die Spur
 * freigibt, und zwar nicht ueber den echten 615-Tage-Deckel, der in der
 * Praxis nie feuert, sondern direkt am dritten `signal`-Argument, das
 * `toolRegistry.execute()` jedem Ausfuehrer reicht (siehe tool-registry.ts).
 *
 * Lauf: npx vitest run src/lib/__tests__/agent-loop-tools-timeout-abort.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { localLaneHolder, queuedRunIds, __resetRunLanesForTests } from '../run-lanes'
import { useGenerationStore } from '../../stores/generationStore'
import { useModelStore } from '../../stores/modelStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { useAgentWorkflowStore } from '../../stores/agentWorkflowStore'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { buildDelegateExecutor, _setDepth, type SubAgentRunner } from '../../api/agents/sub-agent'
import type { AgentRunContext } from '../../api/agent-context'
import type { AgentWorkflow } from '../../types/agent-workflows'

const LOCAL_MODEL = 'qwen3:8b'

// Die ganze Datei braucht allein unter 0,1 s. Im Gesamtlauf unter Maschinenlast
// fielen einzelne Faelle in die 5-s-Grenze von vitest, weil ihre Takte
// (setTimeout 0) nicht drankamen. Die Grenze je Fall ist hier nicht der
// Pruefgegenstand: was "schnell" heisst, messen die Faelle selbst (unter 500 ms
// zwischen Abbruch und Ende), und das bleibt, wie es ist.
vi.setConfig({ testTimeout: 20_000 })

function makeRun(conversationId: string): AgentRunContext {
  return {
    token: 'run', chatId: null, conversationId, workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [],
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const takte = async (n = 20) => { for (let i = 0; i < n; i++) await tick() }

beforeEach(() => {
  __resetRunLanesForTests()
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ activeModel: LOCAL_MODEL })
  _setDepth(0)
})

// ── delegate_task (Vordergrund) ─────────────────────────────────────────

describe('delegate_task im Vordergrund: das dritte signal-Argument bricht den Sub-Agenten wirklich ab', () => {
  it('Abbruch (Stellvertreter fuer den Race-Timeout) beendet den Lauf schnell und gibt die Spur frei', async () => {
    // Steht fuer defaultSubAgentRunner's echte Schleife, die `gates.abortSignal
    // ?.aborted` an jedem Schleifenkopf prueft (sub-agent.ts:545), hier als
    // schneller Poll nachgebaut, damit der Test nicht auf echte Provider-
    // Anbindung angewiesen ist.
    const runner: SubAgentRunner = (_goal, _context, opts) =>
      new Promise((resolve) => {
        const check = () => {
          if (opts.run?.abortSignal?.aborted) { resolve('(sub-agent stopped by the user)'); return }
          setTimeout(check, 2)
        }
        check()
      })

    const exec = buildDelegateExecutor(runner)
    const controller = new AbortController()
    const lauf = exec({ goal: 'lang laufend' }, makeRun('conv-fg'), controller.signal)

    await takte()
    // Der Vordergrundzweig bucht seine EIGENE, generierte Kennung (nicht
    // 'conv-fg'), aber IRGENDEINER haelt jetzt die lokale Spur.
    expect(localLaneHolder()).not.toBeNull()
    expect(queuedRunIds()).toEqual([])

    const start = Date.now()
    controller.abort()
    const out = await lauf
    const elapsedMs = Date.now() - start

    expect(out).toMatch(/stopped by the user/)
    // Schnell: der Poll steht alle 2ms an, kein Warten auf einen echten
    // Deckel (der fuer dieses Werkzeug praktisch nie feuert, siehe
    // tool-timeout.test.ts).
    expect(elapsedMs).toBeLessThan(500)
    expect(localLaneHolder()).toBeNull()
  })

  it('Negativkontrolle: ohne Abbruch laeuft derselbe Aufbau normal durch und gibt die Spur ebenso frei', async () => {
    const runner: SubAgentRunner = async () => 'echtes Ergebnis, kein Abbruch'
    const exec = buildDelegateExecutor(runner)
    const controller = new AbortController()

    const out = await exec({ goal: 'kurz' }, makeRun('conv-fg2'), controller.signal)

    expect(out).toBe('echtes Ergebnis, kein Abbruch')
    expect(controller.signal.aborted).toBe(false)
    expect(localLaneHolder()).toBeNull()
  })

  it('Stop des Nutzers (run.abortSignal, kein separates signal-Argument) bricht ebenfalls ab', async () => {
    const runner: SubAgentRunner = (_goal, _context, opts) =>
      new Promise((resolve) => {
        const check = () => {
          if (opts.run?.abortSignal?.aborted) { resolve('(sub-agent stopped by the user)'); return }
          setTimeout(check, 2)
        }
        check()
      })
    const exec = buildDelegateExecutor(runner)
    const run = makeRun('conv-stop')
    const stopController = new AbortController()
    run.abortSignal = stopController.signal

    // Kein drittes Argument: die einzige Quelle ist run.abortSignal, genau
    // wie ein Aufrufer vor dem vierten `signal`-Parameter der Registry.
    const lauf = exec({ goal: 'x' }, run)
    await takte()
    expect(localLaneHolder()).not.toBeNull()

    stopController.abort()
    const out = await lauf

    expect(out).toMatch(/stopped by the user/)
    expect(localLaneHolder()).toBeNull()
  })
})

// ── run_workflow ─────────────────────────────────────────────────────────

function userInputWorkflow(): AgentWorkflow {
  // Zwei user_input-Schritte, nicht einer: seit dem wfgate-Merge weist
  // run_workflow einen Ablauf mit EINEM user_input-Schritt ohne `input`
  // sofort ab (bau/review-wfgate.md Runde 2 klein 1), der Lauf erreicht die
  // Engine also nie und bucht keine Spur. Der erste Schritt hier wird ueber
  // `args.input` vorbefuellt (workflow-engine.ts prefilledUserInput), der
  // zweite bleibt der reale Haenger, den engine.cancel() beenden muss.
  return {
    id: 'wf', name: 'haengt', description: '', icon: 'Zap',
    steps: [
      { id: 'erst', type: 'user_input', label: 'erst', userInputPrompt: '?' },
      { id: 'zweit', type: 'user_input', label: 'zweit', userInputPrompt: '??' },
    ],
    variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
  }
}

function memoryWorkflow(): AgentWorkflow {
  return {
    id: 'wf2', name: 'kurz', description: '', icon: 'Zap',
    steps: [{
      id: 'merk', type: 'memory_save', label: 'merk',
      memorySave: { type: 'reference', titleTemplate: 't', contentTemplate: 'x', tags: [] },
    }],
    variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
  }
}

function zweiSchritteWorkflow(): AgentWorkflow {
  // Zwei memory_save-Schritte, keiner davon `user_input`: der Abbruch soll
  // NICHT waehrend eines wartenden Schritts passieren (das deckt der Test
  // oben schon ab), sondern GENAU in der Luecke zwischen Schritt 1 und
  // Schritt 2, wo `runSteps` (workflow-engine.ts:431) nur noch seinen
  // eigenen `abortController.signal.aborted` prueft und ohne jedes
  // `onStepError` abbricht (A1, review-teil17-lintfix.md).
  return {
    id: 'wf3', name: 'zwei-schritte', description: '', icon: 'Zap',
    steps: [
      { id: 'erst', type: 'memory_save', label: 'erst', memorySave: { type: 'reference', titleTemplate: 't1', contentTemplate: 'x1', tags: [] } },
      { id: 'zweit', type: 'memory_save', label: 'zweit', memorySave: { type: 'reference', titleTemplate: 't2', contentTemplate: 'x2', tags: [] } },
    ],
    variables: {}, isBuiltIn: false, createdAt: 0, updatedAt: 0,
  }
}

describe('run_workflow: das signal-Argument bricht die WorkflowEngine wirklich ab (engine.cancel())', () => {
  beforeEach(() => {
    registerBuiltinTools(toolRegistry)
  })

  it('Abbruch waehrend eines wartenden Schritts beendet den Lauf und gibt die Spur frei', async () => {
    useAgentWorkflowStore.setState({ workflows: [userInputWorkflow()] })
    const controller = new AbortController()

    const lauf = toolRegistry.execute('run_workflow', { name: 'haengt', input: 'erste Antwort' }, 1, undefined, controller.signal)
    await takte()
    // executeRunWorkflow bucht die feste Kennung 'tool-execution' (builtin-
    // tools.ts), unabhaengig vom aufrufenden Lauf.
    expect(localLaneHolder()).toBe('tool-execution')

    const start = Date.now()
    controller.abort()
    await lauf
    const elapsedMs = Date.now() - start

    expect(elapsedMs).toBeLessThan(500)
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })

  it('Negativkontrolle: ohne Abbruch laeuft ein kurzer Arbeitsablauf normal durch und gibt die Spur frei', async () => {
    useAgentWorkflowStore.setState({ workflows: [memoryWorkflow()] })
    vi.spyOn(useMemoryStore.getState(), 'addMemory').mockImplementation(() => 'mem-id')
    const controller = new AbortController()

    const out = await toolRegistry.execute('run_workflow', { name: 'kurz' }, 1, undefined, controller.signal)

    expect(controller.signal.aborted).toBe(false)
    expect(out).not.toMatch(/Cancelled/)
    expect(localLaneHolder()).toBeNull()
  })

  it('ein schon VOR dem Aufruf abgebrochenes Signal laesst den Lauf nie anfangen (generischer Schutz in toolRegistry.execute)', async () => {
    useAgentWorkflowStore.setState({ workflows: [userInputWorkflow()] })
    const controller = new AbortController()
    controller.abort()

    const out = await toolRegistry.execute('run_workflow', { name: 'haengt' }, 1, undefined, controller.signal)

    expect(out).toMatch(/cancelled by the user before "run_workflow" started/)
    expect(localLaneHolder()).toBeNull()
  })

  it('A1 (review-teil17-lintfix.md): Abbruch ZWISCHEN zwei Schritten gibt dieselbe englische Abbruchmeldung zurueck, nicht ein leeres Ergebnis', async () => {
    useAgentWorkflowStore.setState({ workflows: [zweiSchritteWorkflow()] })
    const controller = new AbortController()
    // Der Mock feuert den Abbruch als Seiteneffekt VON Schritt 1, nicht von
    // aussen per Timer: `addMemory` laeuft synchron in `executeMemorySaveStep`,
    // also ist der Abbruch schon geschehen, bevor `runSteps` zum Schleifenkopf
    // fuer Schritt 2 zurueckkehrt -- genau die Luecke aus A1, nicht der
    // wartende Schritt, den der Test oben schon abdeckt.
    const addMemory = vi.spyOn(useMemoryStore.getState(), 'addMemory')
      .mockImplementationOnce(() => { controller.abort(); return 'mem-1' })
      .mockImplementation(() => 'mem-2')
    // Ein frueherer Test in dieser Datei spioniert dieselbe Funktion aus und
    // stellt sie nie zurueck (kein globales `restoreMocks`); ohne
    // `mockClear()` zaehlt `toHaveBeenCalledTimes` dessen Aufrufe mit.
    addMemory.mockClear()

    const out = await toolRegistry.execute('run_workflow', { name: 'zwei-schritte' }, 1, undefined, controller.signal)

    expect(addMemory).toHaveBeenCalledTimes(1) // Schritt 2 lief NICHT mehr.
    expect(out).toBe('Workflow error: Cancelled')
    expect(localLaneHolder()).toBeNull()
  })
})
