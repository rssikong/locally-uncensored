import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteClient } from '../remoteClient'
import {
  REMOTE_AGENT_PROMPT,
  REMOTE_AGENT_TOOLS,
  REMOTE_TOOL_NEEDS,
  buildRemoteSystemPrompt,
  cavemanReminder,
  describedToolNames,
  isCavemanLevel,
  observationFailed,
  remoteToolsFor,
  runRemoteAgentLoop,
  stopNudge,
  toolObservation,
  type RemoteAgentStep,
} from '../remoteAgent'
import { startFakeDesktop, type FakeDesktop } from './fakeDesktop'

let desktop: FakeDesktop | null = null
afterEach(async () => {
  await desktop?.stop()
  desktop = null
})

async function pairedClient() {
  let token = ''
  const client = createRemoteClient({
    baseUrl: desktop!.url,
    getToken: () => token,
    onToken: (t) => {
      token = t
    },
  })
  await client.pair('123456')
  return client
}

const ALL_OFF = { filesystem: false, downloads: false, process_control: false, shell: false }

describe('Werkzeuge fuer den Remote-Agenten', () => {
  it('bietet ohne Schalter nur die Websuche an und mit Schaltern Dateien und Shell', () => {
    expect(remoteToolsFor(ALL_OFF)).toEqual(['web_search', 'web_fetch'])
    expect(remoteToolsFor(null)).toEqual(['web_search', 'web_fetch'])
    expect(remoteToolsFor({ ...ALL_OFF, filesystem: true })).toEqual(['web_search', 'web_fetch', 'file_read', 'file_write', 'file_list', 'file_search'])
    expect(remoteToolsFor({ ...ALL_OFF, shell: true })).toEqual(['web_search', 'web_fetch', 'shell_execute'])
  })

  it('kennt nur Werkzeuge, die agent-core.js beschreibt', () => {
    const described = describedToolNames()
    for (const name of REMOTE_AGENT_TOOLS) expect(described).toContain(name)
    expect(Object.keys(REMOTE_TOOL_NEEDS)).toEqual([...REMOTE_AGENT_TOOLS])
  })

  it('fuehrt denselben Agenten-Prompt wie die Handy-Webseite des Desktops', () => {
    const source = readFileSync(resolve(process.cwd(), 'mobile-client/client.js'), 'utf8')
    const match = /(?:var|const|let) AGENT_PROMPT\s*=\s*('(?:[^'\\\n]|\\.)*');/.exec(source)
    expect(match).not.toBeNull()
    const original = new Function(`return (${match![1]})`)() as string
    expect(REMOTE_AGENT_PROMPT).toBe(original)
  })
})

describe('Systemprompt und Sprechweise', () => {
  const now = new Date('2026-10-08T12:00:00Z')

  it('bleibt ohne alles leer und nimmt die Persona vor dem Prompt des Desktops', () => {
    expect(buildRemoteSystemPrompt({ caveman: 'off', persona: null, desktopPrompt: '', agent: false, platformLine: '', now })).toBe('')
    expect(buildRemoteSystemPrompt({ caveman: 'off', persona: 'Be a pirate.', desktopPrompt: 'Be brief.', agent: false, platformLine: '', now })).toContain('Be a pirate.')
    expect(buildRemoteSystemPrompt({ caveman: 'off', persona: null, desktopPrompt: 'Be brief.', agent: false, platformLine: '', now })).toContain('Be brief.')
  })

  it('haengt im Agentenmodus Prompt, Plattformzeile und Uhr an', () => {
    const text = buildRemoteSystemPrompt({ caveman: 'off', persona: null, desktopPrompt: '', agent: true, platformLine: 'This machine runs macOS.', now })
    expect(text).toContain(REMOTE_AGENT_PROMPT)
    expect(text).toContain('This machine runs macOS.')
    expect(text).toContain('2026')
  })

  it('kennt drei Stufen und gibt fuer "off" keine Erinnerung', () => {
    expect(isCavemanLevel('lite')).toBe(true)
    expect(isCavemanLevel('loud')).toBe(false)
    expect(cavemanReminder('off')).toBe('')
    expect(cavemanReminder('full')).not.toBe('')
    expect(buildRemoteSystemPrompt({ caveman: 'ultra', persona: null, desktopPrompt: '', agent: false, platformLine: '', now })).not.toBe('')
  })
})

describe('Beobachtungen', () => {
  it('macht aus einem Fehler eine Zeile, die als Fehler erkannt wird', () => {
    const text = toolObservation({ ok: false, error: 'Tool `shell_execute` is gated', needsPermission: 'shell', data: null } as never, {})
    expect(observationFailed(text)).toBe(true)
    expect(text).toContain('gated')
  })

  it('stoesst ein Modell an, das leer aufhoert, und laesst eine echte Antwort gelten', () => {
    expect(stopNudge('', 1)).toContain('not finished')
    expect(stopNudge('', 0)).toBe('')
    expect(stopNudge('The file has 3 lines and ends with a newline.', 2)).toBe('')
    expect(stopNudge('I will summarize the results now', 2)).toContain('never wrote it')
  })
})

describe('Agentenlauf gegen den Attrappen-Desktop', () => {
  it('fuehrt einen Werkzeugaufruf am Desktop aus und endet mit der Antwort', async () => {
    desktop = await startFakeDesktop({ reply: 'The file says: file body.' })
    desktop.permissions.filesystem = true
    desktop.nextToolCalls = [{ function: { name: 'file_read', arguments: { path: 'notes.txt' } } }]
    const client = await pairedClient()
    const seen: RemoteAgentStep[][] = []
    const result = await runRemoteAgentLoop({
      client,
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'Read notes.txt' }],
      tools: remoteToolsFor(desktop.permissions),
      chatId: 'c1',
      onSteps: (steps) => seen.push(steps),
    })
    expect(result.end).toBe('done')
    expect(result.content).toBe('The file says: file body.')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ tool: 'file_read', state: 'done' })
    expect(result.steps[0].result).toContain('file body')
    expect(seen[0][0].state).toBe('running')
    expect(desktop.toolCalls).toHaveLength(1)
    expect(desktop.toolCalls[0]).toMatchObject({ tool: 'file_read' })
    // Zweite Runde: das Ergebnis des Werkzeugs steht im Verlauf fuer das Modell.
    const second = desktop.chatRequests[1].body.messages as Array<{ role: string; content: string }>
    expect(second.some((m) => m.role === 'tool' && m.content.includes('file body'))).toBe(true)
    expect(Array.isArray(desktop.chatRequests[0].body.tools)).toBe(true)
    expect(desktop.chatRequests[0].body.stream).toBe(false)
  })

  it('fuehrt ein Werkzeug nicht aus, das nicht angeboten wurde', async () => {
    desktop = await startFakeDesktop({ reply: 'Done without it.' })
    desktop.nextToolCalls = [{ function: { name: 'shell_execute', arguments: { command: 'ls' } } }]
    const client = await pairedClient()
    const result = await runRemoteAgentLoop({
      client,
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'List files' }],
      tools: remoteToolsFor(ALL_OFF),
      chatId: 'c1',
    })
    expect(desktop.toolCalls).toHaveLength(0)
    expect(result.steps).toHaveLength(0)
  })

  it('meldet einen gesperrten Schalter am Schritt, wenn der Desktop ihn inzwischen ausgeschaltet hat', async () => {
    desktop = await startFakeDesktop({ reply: 'I could not read it.' })
    desktop.nextToolCalls = [{ function: { name: 'file_read', arguments: { path: 'a.txt' } } }]
    const client = await pairedClient()
    const result = await runRemoteAgentLoop({
      client,
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'Read a.txt' }],
      // Angeboten mit dem alten Stand der Schalter; der Desktop prueft selbst.
      tools: remoteToolsFor({ ...ALL_OFF, filesystem: true }),
      chatId: 'c1',
    })
    expect(result.steps[0]).toMatchObject({ tool: 'file_read', state: 'failed', needsPermission: 'filesystem' })
    expect(result.end).toBe('done')
  })

  it('endet mit "no-tools", wenn das Modell keine Werkzeuge kann', async () => {
    desktop = await startFakeDesktop({ models: ['notools:1b'] })
    const client = await pairedClient()
    const result = await runRemoteAgentLoop({
      client,
      model: 'notools:1b',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: remoteToolsFor(ALL_OFF),
      chatId: 'c1',
    })
    expect(result.end).toBe('no-tools')
  })

  it('endet mit "aborted", wenn vor dem Lauf abgebrochen wurde, und ruft den Desktop nicht', async () => {
    desktop = await startFakeDesktop()
    const client = await pairedClient()
    const ctrl = new AbortController()
    ctrl.abort()
    const result = await runRemoteAgentLoop({
      client,
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: remoteToolsFor(ALL_OFF),
      chatId: 'c1',
      signal: ctrl.signal,
    })
    expect(result.end).toBe('aborted')
    expect(desktop.chatRequests).toHaveLength(0)
  })

  it('hoert nach der Hoechstzahl an Runden auf', async () => {
    desktop = await startFakeDesktop({ reply: '' })
    const client = await pairedClient()
    const wrapped = {
      chatWithTools: async (input: Parameters<typeof client.chatWithTools>[0]) => {
        desktop!.nextToolCalls = [{ function: { name: 'web_search', arguments: { query: 'x' } } }]
        return client.chatWithTools(input)
      },
      runAgentTool: client.runAgentTool.bind(client),
    }
    const result = await runRemoteAgentLoop({
      client: wrapped,
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'Search forever' }],
      tools: remoteToolsFor(ALL_OFF),
      chatId: 'c1',
      maxIterations: 3,
    })
    expect(result.end).toBe('max-iterations')
    expect(result.steps).toHaveLength(3)
  })
})

describe('A17: image_generate und video_generate laufen als Create auf dem Rechner', () => {
  it('stehen nur mit Merkmal (Recht create) und Ausfuehrer in der Liste', async () => {
    const { setRemoteCreateRunner } = await import('../remoteAgent')
    expect(remoteToolsFor(ALL_OFF, ['create-image', 'create-video'])).toEqual(['web_search', 'web_fetch'])
    setRemoteCreateRunner(async () => ({ ok: true, observation: 'x' }))
    try {
      expect(remoteToolsFor(ALL_OFF, ['create-image'])).toEqual(['web_search', 'web_fetch', 'image_generate'])
      expect(remoteToolsFor(ALL_OFF, ['create-image', 'create-video'])).toEqual(['web_search', 'web_fetch', 'image_generate', 'video_generate'])
      expect(remoteToolsFor(ALL_OFF, ['sealed'])).toEqual(['web_search', 'web_fetch'])
    } finally {
      setRemoteCreateRunner(null)
    }
  })

  it('der Aufruf geht an den Ausfuehrer, nie an agent-tool, und das Bild haengt am Schritt', async () => {
    let round = 0
    const sentTools: unknown[][] = []
    const agentTool: string[] = []
    const client = {
      chatWithTools: async (req: { tools?: unknown[] }) => {
        sentTools.push(req.tools ?? [])
        round += 1
        if (round === 1) return { content: '', thinking: '', toolCalls: [{ function: { name: 'image_generate', arguments: { prompt: 'a red fox' } } }] }
        return { content: 'Here is your fox.', thinking: '', toolCalls: [] }
      },
      runAgentTool: async (req: { tool: string }) => {
        agentTool.push(req.tool)
        return { ok: true, data: 'nope' }
      },
    }
    const asked: Array<[string, Record<string, unknown>]> = []
    const result = await runRemoteAgentLoop({
      client: client as never,
      model: 'm',
      messages: [{ role: 'user', content: 'draw a fox' }],
      tools: ['web_search', 'image_generate'],
      chatId: 'c1',
      createRunner: async (tool, args) => {
        asked.push([tool, args])
        return { ok: true, observation: 'The image was created.', media: [{ id: `pc_res_${'a'.repeat(32)}`, kind: 'image', mime: 'image/png' }] }
      },
    })
    expect(result.end).toBe('done')
    expect(result.content).toBe('Here is your fox.')
    expect(asked).toEqual([['image_generate', { prompt: 'a red fox' }]])
    expect(agentTool).toEqual([])
    expect(result.steps[0]).toMatchObject({ tool: 'image_generate', state: 'done', media: [{ kind: 'image' }] })
    // The model reads the description of the phone, not the one of the desktop with file names.
    const def = (sentTools[0] as Array<{ function: { name: string; description: string } }>).find((t) => t.function.name === 'image_generate')!
    expect(def.function.description).toContain("user's computer")
    expect(def.function.description).not.toContain('inputImage')
  })

  it('ein Fehler des Ausfuehrers ist ein gescheiterter Schritt mit Error', async () => {
    let round = 0
    const client = {
      chatWithTools: async () => {
        round += 1
        return round === 1
          ? { content: '', thinking: '', toolCalls: [{ function: { name: 'video_generate', arguments: { prompt: 'waves' } } }] }
          : { content: 'It did not work.', thinking: '', toolCalls: [] }
      },
      runAgentTool: async () => ({ ok: true, data: '' }),
    }
    const result = await runRemoteAgentLoop({
      client: client as never,
      model: 'm',
      messages: [{ role: 'user', content: 'a video' }],
      tools: ['video_generate'],
      chatId: 'c1',
      createRunner: async () => ({ ok: false, observation: 'No video model is installed on your computer.' }),
    })
    expect(result.steps[0]).toMatchObject({ state: 'failed', result: 'Error: No video model is installed on your computer.' })
  })
})
