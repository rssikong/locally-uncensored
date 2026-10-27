/** Diagnostics rows, the report, the self test figures and the three checks. */
import { describe, expect, it } from 'vitest'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { cloudCheck, engineCheck, internetCheck, lightWord } from '../parts/checks'
import { acceleratorOf, buildLogText, buildReport, diagnosticsRows, modelNameFromPath, selfTestSpeed, shownModelName, type DiagnosticsData } from '../parts/diagnostics'
import { SESSION_LOG_MAX, __clearSessionLogForTests, errorLine, recordSessionError, sessionLog } from '../parts/session-log'
import { LOG_TAIL_LINES, crashHeadline, logTailText, parseLogTail, readAppLog } from '../parts/app-log'
import { __setBridgeForTests } from '../../../platform/bridge'

const T = SETTINGS_STRINGS.troubleshooting
const GIB = 1024 ** 3

const engine = (over: Record<string, unknown> = {}) => ({ running: true, healthy: true, port: 8127, model_path: '/data/models/gemma-3-4b-it-Q4_K_M.gguf', ctx: 8192, cpuOnly: false, gpuLayers: null, sanityNote: null, ...over })

const full: DiagnosticsData = {
  appVersion: '3.0.5',
  device: { platform: 'android', model: 'Pixel 8', ramTotalBytes: 8 * GIB, ramAvailableBytes: 3 * GIB, storageFreeBytes: 40 * GIB, storageTotalBytes: 128 * GIB, source: 'native' },
  storage: { usageBytes: 2 * GIB, quotaBytes: 60 * GIB, freeBytes: 58 * GIB, percentUsed: 3.3 },
  engine: engine(),
  benchmarkSpeed: 14.26,
  selfTest: null,
}

const bare: DiagnosticsData = { appVersion: '3.0.5', device: { platform: 'android', source: 'none' }, storage: null, engine: null, benchmarkSpeed: null, selfTest: null }

const value = (d: DiagnosticsData, id: string) => diagnosticsRows(d).find((r) => r.id === id)

describe('diagnosticsRows', () => {
  it('has the rows of the checklist, in its order', () => {
    expect(diagnosticsRows(full).map((r) => r.label)).toEqual(['Device', 'System', 'App version', 'Build', 'Memory', 'Memory available to LU', 'Storage free', 'Storage used by LU', 'Accelerator', 'Model loaded', 'Last speed'])
  })

  it('shows what the device and the engine said', () => {
    expect(value(full, 'device')?.value).toBe('Pixel 8')
    expect(value(full, 'memory')?.value).toBe('8.0 GB')
    expect(value(full, 'memory-free')?.value).toBe('3.0 GB')
    expect(value(full, 'storage-free')?.value).toBe('40.0 GB')
    expect(value(full, 'storage-used')?.value).toBe('2.0 GB')
    expect(value(full, 'accelerator')?.value).toBe(T.accelGpu)
    // N1: the name the user picked the model by, not the name of its file.
    expect(value(full, 'model')?.value).toBe('Gemma 3 4B')
    expect(value(full, 'model')?.note).toBe('context 8K')
    expect(value(full, 'speed')?.value).toBe('14 tokens per second')
  })

  it('never says "Not available": a browser preview names the installed app, and guesses nothing', () => {
    for (const id of ['device', 'system', 'memory', 'memory-free', 'storage-free', 'accelerator', 'model']) {
      expect(value(bare, id)?.value, id).toBe(T.needsApp)
    }
    expect(value(bare, 'storage-used')?.value).toBe(T.notReported)
    expect(value(bare, 'speed')?.value).toBe(T.speedNone)
    expect(value(bare, 'app-version')?.value).toBe('3.0.5')
    for (const row of diagnosticsRows(bare)) expect(row.value, row.id).not.toBe('Not available')
    for (const row of diagnosticsRows(full)) expect(row.value, row.id).not.toBe('Not available')
  })

  it('N16: "Storage used by LU" is one sum with the models, and the second line splits it', () => {
    const MIB = 1024 * 1024
    const phone: DiagnosticsData = { ...full, storage: { usageBytes: 3 * MIB, quotaBytes: 60 * GIB, freeBytes: 59 * GIB, percentUsed: 0.1 }, modelsBytes: 1.5 * GIB }
    const row = value(phone, 'storage-used')
    expect(row?.value).toBe('1.5 GB')
    expect(row?.note).toBe('Models 1.5 GB, chats and files 3.0 MB')
    // No model installed is a real zero, and the sum is what the chats take.
    expect(value({ ...phone, modelsBytes: 0 }, 'storage-used')).toMatchObject({ value: '3.0 MB', note: 'Models 0 B, chats and files 3.0 MB' })
  })

  it('N16: a part nobody could read is named, never counted as zero', () => {
    // The engine did not answer on a phone: the figure is the chats alone, and the row says so.
    expect(value({ ...full, modelsBytes: null }, 'storage-used')).toMatchObject({ value: '2.0 GB', note: T.storageWithoutModels })
    // A browser preview has no models at all: no note needed.
    expect(value({ ...full, device: { ...full.device, source: 'browser' }, modelsBytes: null }, 'storage-used')?.note).toBeUndefined()
    // The WebView does not say what it holds, the models are known.
    expect(value({ ...full, storage: null, modelsBytes: 2 * GIB }, 'storage-used')).toMatchObject({ value: '2.0 GB', note: 'Models 2.0 GB. This phone does not report the size of chats and files.' })
  })

  it('shows what device_info of the bridge delivers: maker, system, chip, storage total, text scale', () => {
    const phone: DiagnosticsData = {
      ...full,
      device: { ...full.device, manufacturer: 'Google', systemVersion: '14', chip: 'Tensor G3', fontScale: 1.3 },
      scaffold: { fontScale: 1.3 } as NonNullable<DiagnosticsData['scaffold']>,
    }
    expect(value(phone, 'device')).toMatchObject({ value: 'Google Pixel 8', note: 'Android' })
    expect(value(phone, 'system')).toMatchObject({ value: 'Android 14', note: 'Chip Tensor G3' })
    expect(value(phone, 'storage-free')).toMatchObject({ value: '40.0 GB', note: 'of 128.0 GB' })
    expect(value(phone, 'text-size')).toMatchObject({ value: '130 %', note: T.textSizeFollows })
  })

  it('does not repeat the maker when the model already starts with it', () => {
    const d: DiagnosticsData = { ...full, device: { ...full.device, manufacturer: 'samsung', model: 'Samsung SM-S911B' } }
    expect(value(d, 'device')?.value).toBe('Samsung SM-S911B')
  })

  it('says when the shell draws a different size than the phone asks for (the cap at 200 percent)', () => {
    const d: DiagnosticsData = { ...full, device: { ...full.device, fontScale: 2.3 }, scaffold: { fontScale: 2 } as NonNullable<DiagnosticsData['scaffold']> }
    expect(value(d, 'text-size')).toMatchObject({ value: '200 %', note: 'the phone asks for 230 %' })
  })

  it('has no text size row when nobody knows the scale', () => {
    expect(value(full, 'text-size')).toBeUndefined()
  })

  it('a simulator is named, and what it does not report says so', () => {
    const sim: DiagnosticsData = { ...full, device: { platform: 'ios', model: 'iPhone15,4', ramTotalBytes: 16 * GIB, storageFreeBytes: 40 * GIB, simulator: true, source: 'native' } }
    expect(value(sim, 'device')).toMatchObject({ value: 'iPhone15,4', note: T.simulator })
    expect(value(sim, 'memory-free')?.value).toBe(T.simulatorSilent)
    expect(value(sim, 'system')?.value).toBe(T.simulatorSilent)
  })

  it('a phone that leaves a figure out says that this phone does not report it', () => {
    const d: DiagnosticsData = { ...full, device: { platform: 'android', model: 'Pixel 8', source: 'native' }, engine: null }
    expect(value(d, 'memory')?.value).toBe(T.notReported)
    expect(value(d, 'storage-free')?.value).toBe(T.notReported)
    // On a phone a missing engine answer is the engine's silence, not a missing app.
    expect(value(d, 'accelerator')?.value).toBe(T.engineSilent)
    expect(value(d, 'model')?.value).toBe(T.engineSilent)
  })

  it('the phone says memory is low: the row carries it', () => {
    const d: DiagnosticsData = { ...full, device: { ...full.device, lowMemory: true } }
    expect(value(d, 'memory')?.note).toBe(T.memoryLow)
  })

  it('the crash row exists only where the native layer could be asked', () => {
    expect(value(full, 'crash')).toBeUndefined()
    expect(value({ ...full, lastCrash: null }, 'crash')).toMatchObject({ value: T.lastCrashNone })
    const crashed = value({ ...full, lastCrash: '2026-10-08T09:00:00Z panic in engine thread\n  at frame 1\n  at frame 2' }, 'crash')
    expect(crashed).toMatchObject({ value: '2026-10-08T09:00:00Z panic in engine thread', note: T.lastCrashNote })
  })

  it('marks figures the WebView only estimated', () => {
    const estimated: DiagnosticsData = { ...bare, device: { platform: 'android', ramTotalBytes: 4 * GIB, storageFreeBytes: GIB, source: 'browser' } }
    expect(value(estimated, 'memory')?.note).toBe(T.estimated)
    expect(value(estimated, 'storage-free')?.note).toBe(T.estimated)
    expect(value(estimated, 'memory-free')?.note).toBeUndefined()
  })

  it('tells an engine without a model from no engine', () => {
    const idle: DiagnosticsData = { ...full, engine: engine({ running: false, model_path: null, ctx: null }), benchmarkSpeed: null }
    expect(value(idle, 'model')?.value).toBe(T.noModel)
    expect(value(idle, 'accelerator')?.value).toBe(T.engineOff)
  })

  it('falls back to the last self test for the speed', () => {
    const tested: DiagnosticsData = { ...bare, selfTest: { tokensPerSecond: 7.25, model: 'tiny', at: 1 } }
    expect(value(tested, 'speed')?.value).toBe('7.3 tokens per second')
    expect(value(tested, 'speed')?.note).toBe('measured with tiny')
  })
})

describe('the reading of the scaffold', () => {
  const measured = { tokens: 120, ms: 10_000, model: 'gemma-3-4b', where: 'device' as const, tokensPerSecond: 12, at: 5 }

  it('the speed of a real answer wins over benchmark and self test', () => {
    const d: DiagnosticsData = { ...full, selfTest: { tokensPerSecond: 7.25, model: 'tiny', at: 1 }, measured }
    expect(value(d, 'speed')?.value).toBe('12 tokens per second')
    expect(value(d, 'speed')?.note).toBe('measured with gemma-3-4b')
  })

  it('a cloud answer says nothing about this phone', () => {
    const d: DiagnosticsData = { ...full, measured: { ...measured, where: 'cloud' } }
    expect(value(d, 'speed')?.value).toBe('14 tokens per second')
  })

  it('its plain lines close the report, once, without a second title', () => {
    const scaffold = {
      device: { ...full.device, systemVersion: '14', chip: 'Tensor G3' },
      fit: { device: { platform: 'android' as const, ramGb: 8 }, source: 'device' as const, simulator: false, label: null },
      engine: { state: 'running' as const, model: 'gemma.gguf', contextTokens: 8192, accelerator: 'gpu' as const, note: null },
      speed: null,
      fontScale: 1.3,
      theme: 'dark' as const,
      persistentStorage: 'granted' as const,
      nativeBridge: true,
      userAgent: 'Test/1',
      at: Date.UTC(2026, 9, 8),
    } as unknown as NonNullable<DiagnosticsData['scaffold']>
    const text = buildReport({ ...full, measured, scaffold }, Date.UTC(2026, 9, 8))
    expect(text).toContain('Chip: Tensor G3')
    expect(text).toContain('Text size: 130 percent')
    expect(text).toContain('Last speed: 12 tokens per second')
    expect(text.match(/LU diagnostics/g)).toHaveLength(1)
    expect(text).not.toContain('/data/models')
  })
})

describe('acceleratorOf', () => {
  it('reads the engine state', () => {
    expect(acceleratorOf(null)).toBe('unknown')
    expect(acceleratorOf(engine({ running: false }))).toBe('unknown')
    expect(acceleratorOf(engine())).toBe('gpu')
    expect(acceleratorOf(engine({ gpuLayers: 0 }))).toBe('cpu')
    expect(acceleratorOf(engine({ cpuOnly: true }))).toBe('cpu-fallback')
  })
})

describe('modelNameFromPath', () => {
  it('cuts folder and extension, on both kinds of path', () => {
    expect(modelNameFromPath('/a/b/model-Q4.gguf')).toBe('model-Q4')
    expect(modelNameFromPath('C:\\models\\Model.GGUF')).toBe('Model')
    expect(modelNameFromPath(null)).toBeNull()
    expect(modelNameFromPath('')).toBeNull()
  })
})

describe('shownModelName (N1)', () => {
  it('turns a file of the catalogue into the name of the catalogue, with or without provider, folder and extension', () => {
    expect(shownModelName('SmolLM2-360M-Instruct-Q4_K_M')).toBe('SmolLM2 360M')
    expect(shownModelName('openai::SmolLM2-360M-Instruct-Q4_K_M')).toBe('SmolLM2 360M')
    expect(shownModelName('/data/models/SmolLM2-360M-Instruct-Q4_K_M.gguf')).toBe('SmolLM2 360M')
  })

  it('keeps the file name of a model the catalogue does not know, without the provider in front', () => {
    expect(shownModelName('openai::my-own-model-Q5')).toBe('my-own-model-Q5')
    expect(shownModelName('')).toBe('')
    expect(shownModelName(null)).toBe('')
  })

  it('the engine check and the speed row speak the same name', () => {
    expect(engineCheck(true, { running: true, healthy: true, model_path: '/m/SmolLM2-360M-Instruct-Q4_K_M.gguf' }).text).toBe('Running with SmolLM2 360M')
    const rows = diagnosticsRows({ ...full, measured: { where: 'device', tokensPerSecond: 8.5, model: 'openai::SmolLM2-360M-Instruct-Q4_K_M', at: 1 } as DiagnosticsData['measured'] })
    expect(rows.find((r) => r.id === 'speed')?.note).toBe('measured with SmolLM2 360M')
  })
})

describe('buildReport', () => {
  it('starts with the title and carries every row', () => {
    const lines = buildReport(full, Date.UTC(2026, 9, 8)).split('\n')
    expect(lines[0]).toBe('LU diagnostics report')
    expect(lines[1]).toBe('2026-10-08T00:00:00.000Z')
    expect(lines).toContain('Device: Pixel 8 (Android)')
    expect(lines).toContain('Model loaded: Gemma 3 4B (context 8K)')
    // The exact file is what support needs, so the report (not the page) carries it too.
    expect(lines).toContain('Model file: gemma-3-4b-it-Q4_K_M')
    expect(lines).toContain('System: This phone does not report it')
    expect(lines).toContain('Build: Open build (open)')
    expect(lines.filter((l) => l.includes(': '))).toHaveLength(12)
  })

  it('holds no path and no account', () => {
    const text = buildReport(full)
    expect(text).not.toContain('/data/models')
    expect(text).not.toContain('@')
  })
})

describe('selfTestSpeed', () => {
  it('uses the count of the engine', () => {
    expect(selfTestSpeed(30, 'ready', 2000)).toBe(15)
  })

  it('estimates from the answer when the engine sent no count', () => {
    expect(selfTestSpeed(undefined, 'x'.repeat(40), 1000)).toBe(10)
    expect(selfTestSpeed(0, '', 1000)).toBe(1)
  })

  it('survives a zero duration', () => {
    expect(Number.isFinite(selfTestSpeed(5, 'a', 0))).toBe(true)
  })
})

describe('checks', () => {
  it('reads the engine', () => {
    expect(engineCheck(false, null)).toEqual({ light: 'warn', text: T.engineUnavailable })
    expect(engineCheck(true, null).light).toBe('bad')
    expect(engineCheck(true, { running: false, healthy: false, model_path: null })).toEqual({ light: 'ok', text: T.engineIdle })
    expect(engineCheck(true, { running: true, healthy: false, model_path: '/m/a.gguf' }).light).toBe('bad')
    expect(engineCheck(true, { running: true, healthy: true, model_path: '/m/a.gguf' })).toEqual({ light: 'ok', text: 'Running with a' })
  })

  it('reads internet and cloud', () => {
    expect(internetCheck(true).light).toBe('ok')
    expect(internetCheck(false)).toEqual({ light: 'warn', text: T.internetOff })
    expect(cloudCheck(false, null, true)).toEqual({ light: 'warn', text: T.cloudOffline })
    expect(cloudCheck(true, null, true).light).toBe('bad')
    expect(cloudCheck(true, 502, true).light).toBe('bad')
    // 401 is an answer: the server is there.
    expect(cloudCheck(true, 401, false)).toEqual({ light: 'ok', text: T.cloudOk })
    expect(cloudCheck(true, 200, true)).toEqual({ light: 'ok', text: T.cloudSignedIn })
  })

  it('has a word for every light, so colour is never the only signal', () => {
    expect([lightWord('ok'), lightWord('warn'), lightWord('bad'), lightWord('busy')]).toEqual(['OK', 'Check', 'Problem', 'Checking'])
  })
})

describe('session log', () => {
  it('keeps errors as one short line', () => {
    expect(errorLine(new TypeError('x is\n  not a function'))).toBe('TypeError: x is not a function')
    expect(errorLine('a'.repeat(500)).length).toBe(303)
    expect(errorLine({ a: 1 })).toBe('{"a":1}')
  })

  it('holds the newest entries only', () => {
    __clearSessionLogForTests()
    for (let i = 0; i < SESSION_LOG_MAX + 5; i++) recordSessionError('error', `e${i}`, i)
    expect(sessionLog()).toHaveLength(SESSION_LOG_MAX)
    expect(sessionLog()[0].message).toBe('e5')
    __clearSessionLogForTests()
  })

  it('goes into the log text under the report', () => {
    const text = buildLogText(bare, [{ at: 0, kind: 'error', message: 'boom' }], [{ key: 'chat-conversations', at: 0 }], 0)
    expect(text.split('\n')[0]).toBe('LU diagnostics report')
    expect(text).toContain('1970-01-01T00:00:00.000Z error boom')
    expect(text).toContain(T.storageHeading)
    expect(buildLogText(bare, [], [], 0)).toContain(T.logNoErrors)
  })
})

describe('the app log (readLogTail of the bridge)', () => {
  const tail = { file: 'lu.log', text: 'line one\nline two', lineCount: 2, truncated: false, lastCrash: null }

  it('parses what the bridge answers and refuses anything else', () => {
    expect(parseLogTail(tail)).toEqual(tail)
    expect(parseLogTail({ text: 'a\nb\nc' })).toEqual({ file: '', text: 'a\nb\nc', lineCount: 3, truncated: false, lastCrash: null })
    expect(parseLogTail({ file: 'x', text: '', lineCount: 0, truncated: false, lastCrash: '   ' })?.lastCrash).toBeNull()
    expect(parseLogTail(null)).toBeNull()
    expect(parseLogTail('log')).toBeNull()
    expect(parseLogTail({ file: 'x' })).toBeNull()
  })

  it('words a tail the way the bridge does: the crash record first, then the lines', () => {
    expect(logTailText(tail)).toBe('Log (lu.log, last 2 lines):\nline one\nline two\n')
    expect(logTailText({ ...tail, lastCrash: 'panic at 09:00' })).toBe('Last crash:\npanic at 09:00\n\nLog (lu.log, last 2 lines):\nline one\nline two\n')
    expect(logTailText({ ...tail, text: '', lineCount: 0 })).toBe('The log is empty.\n')
  })

  it('reads through the bridge and uses its wording', async () => {
    __setBridgeForTests({
      readLogTail: async (maxLines?: number) => ({ ...tail, lineCount: maxLines === LOG_TAIL_LINES ? 2 : -1, lastCrash: 'panic' }),
      logTailAsText: () => 'WORDED BY THE BRIDGE',
    } as never)
    const log = await readAppLog()
    expect(log?.tail).toMatchObject({ file: 'lu.log', lineCount: 2, lastCrash: 'panic' })
    expect(log?.text).toBe('WORDED BY THE BRIDGE')
    __setBridgeForTests(undefined)
  })

  it('is null without a bridge, with an older bridge, and when the read fails', async () => {
    __setBridgeForTests(null)
    expect(await readAppLog()).toBeNull()
    __setBridgeForTests({} as never)
    expect(await readAppLog()).toBeNull()
    __setBridgeForTests({ readLogTail: async () => { throw new Error('no such command') } } as never)
    expect(await readAppLog()).toBeNull()
    __setBridgeForTests({ readLogTail: async () => ({ nothing: true }) } as never)
    expect(await readAppLog()).toBeNull()
    __setBridgeForTests(undefined)
  })

  it('"Share log" carries the file: report, app log with the crash record, then this session', () => {
    const appLog = { tail: { ...tail, lastCrash: 'panic at 09:00' }, text: logTailText({ ...tail, lastCrash: 'panic at 09:00' }) }
    const text = buildLogText(bare, [{ at: 0, kind: 'error', message: 'boom' }], [], 0, appLog)
    const at = (needle: string) => text.indexOf(needle)
    expect(at('LU diagnostics report')).toBe(0)
    expect(at(T.appLogHeading)).toBeGreaterThan(0)
    expect(at('Last crash:\npanic at 09:00')).toBeGreaterThan(at(T.appLogHeading))
    expect(at('line one\nline two')).toBeGreaterThan(at('Last crash:'))
    expect(at(T.logHeading)).toBeGreaterThan(at('line two'))
    expect(text).toContain('1970-01-01T00:00:00.000Z error boom')
    expect(text).not.toContain(T.appLogMissing)
  })

  it('says how much was left out when the file is longer than the tail', () => {
    const appLog = { tail: { ...tail, lineCount: 400, truncated: true }, text: 'x' }
    expect(buildLogText(bare, [], [], 0, appLog)).toContain('Only the last 400 lines are included.')
  })

  it('without the file it says so instead of leaving a gap', () => {
    const text = buildLogText(bare, [], [], 0, null)
    expect(text).toContain(T.appLogMissing)
    expect(text).toContain(T.logNoErrors)
  })

  it('cuts a crash record to one short line for the row', () => {
    expect(crashHeadline(null)).toBeNull()
    expect(crashHeadline('\n\n')).toBeNull()
    expect(crashHeadline('  first line  \nsecond')).toBe('first line')
    expect(crashHeadline('x'.repeat(300))).toHaveLength(120)
  })
})
