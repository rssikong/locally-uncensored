import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INTERRUPTED_EMPTY_TEXT, INTERRUPTED_FINISH_REASON } from '../../../../lib/interrupted-runs'
import { buildFatalReport } from '../../../resilience/FatalScreen'
import { RESUME_MAX_AGE_MS, RESUME_SEEN_MAX, RESUME_TITLE_MAX, interruptedReplies, pickedUpJobs, resumeShown, resumeText, seenByOpening, withSeen } from '../../../resilience/ResumeNotice'
import { CONFIRM_MISS_MS, OFFLINE_BACKOFF_MS, ONLINE_RECHECK_MS, createOnlineMonitor, probeUrl } from '../../../resilience/useOnline'

/** A clock and a network the test moves by hand. */
function world(start: { link: boolean; reachable: boolean; cloud?: boolean }) {
  let now = 0
  let link = start.link
  let visible = true
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  let nextId = 1
  const linkListeners = new Set<(online: boolean) => void>()
  const foreground = new Set<() => void>()
  const state = { reachable: start.reachable, probes: 0, cloud: start.cloud ?? true }
  const monitor = createOnlineMonitor({
    probe: async () => {
      state.probes += 1
      return state.reachable
    },
    probeWanted: () => state.cloud,
    linkExists: () => link,
    onLinkChange: (fn) => {
      linkListeners.add(fn)
      return () => linkListeners.delete(fn)
    },
    onForeground: (fn) => {
      foreground.add(fn)
      return () => foreground.delete(fn)
    },
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
    visible: () => visible,
  })
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  return {
    monitor,
    state,
    settle,
    /** Move the clock and run what came due, one timer at a time. */
    async pass(ms: number) {
      const end = now + ms
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.splice(timers.indexOf(due), 1)
        now = due.at
        due.fn()
        await settle()
      }
      now = end
    },
    async setLink(value: boolean) {
      link = value
      for (const fn of [...linkListeners]) fn(value)
      await settle()
    },
    setVisible(value: boolean) {
      visible = value
    },
    async comeBack() {
      visible = true
      for (const fn of [...foreground]) fn()
      await settle()
    },
    pending: () => timers.length,
  }
}

describe('the online state behind the offline line', () => {
  it('starts as online while the first answer is out, and stays online when it comes', async () => {
    const w = world({ link: true, reachable: true })
    expect(w.monitor.get()).toEqual({ online: true, state: 'checking' })
    w.monitor.subscribe(() => {})
    await w.settle()
    expect(w.monitor.get()).toEqual({ online: true, state: 'online' })
  })

  it('one miss proves nothing, the second one in a row means offline', async () => {
    const w = world({ link: true, reachable: true })
    const seen: boolean[] = []
    w.monitor.subscribe(() => seen.push(w.monitor.get().online))
    await w.settle()
    w.state.reachable = false
    await w.pass(ONLINE_RECHECK_MS)
    // A Wi-Fi without internet: the browser still says "online", the first probe got nothing.
    expect(w.monitor.get().online).toBe(true)
    await w.pass(CONFIRM_MISS_MS)
    expect(w.monitor.get()).toEqual({ online: false, state: 'offline' })
    expect(seen.at(-1)).toBe(false)
  })

  it('a single lost probe does not flash the line', async () => {
    const w = world({ link: true, reachable: true })
    const seen: string[] = []
    w.monitor.subscribe(() => seen.push(w.monitor.get().state))
    await w.settle()
    w.state.reachable = false
    await w.pass(ONLINE_RECHECK_MS)
    w.state.reachable = true
    await w.pass(CONFIRM_MISS_MS)
    expect(w.monitor.get()).toEqual({ online: true, state: 'online' })
    expect(seen).not.toContain('offline')
  })

  it('comes back by itself, asking less often the longer the network is gone', async () => {
    const w = world({ link: true, reachable: false })
    w.monitor.subscribe(() => {})
    await w.settle()
    // The very first answer is missing too: confirmed after the second probe.
    await w.pass(CONFIRM_MISS_MS)
    expect(w.monitor.get().online).toBe(false)
    const before = w.state.probes
    await w.pass(OFFLINE_BACKOFF_MS[0] + OFFLINE_BACKOFF_MS[1])
    expect(w.state.probes - before).toBe(2)
    w.state.reachable = true
    await w.pass(OFFLINE_BACKOFF_MS[2])
    expect(w.monitor.get()).toEqual({ online: true, state: 'online' })
  })

  it('no link is offline at once, and "online" from the browser is only a hint', async () => {
    const w = world({ link: true, reachable: true })
    w.monitor.subscribe(() => {})
    await w.settle()
    await w.setLink(false)
    expect(w.monitor.get()).toEqual({ online: false, state: 'offline' })
    w.state.reachable = false
    await w.setLink(true)
    expect(w.monitor.get().online).toBe(false)
    w.state.reachable = true
    await w.pass(OFFLINE_BACKOFF_MS[0])
    expect(w.monitor.get().online).toBe(true)
  })

  it('asks nothing while the app is away and asks on the return', async () => {
    const w = world({ link: true, reachable: true })
    w.monitor.subscribe(() => {})
    await w.settle()
    const before = w.state.probes
    w.setVisible(false)
    await w.pass(ONLINE_RECHECK_MS * 3)
    expect(w.state.probes).toBe(before)
    await w.comeBack()
    expect(w.state.probes).toBe(before + 1)
  })

  it('a failed request elsewhere starts a check, and nobody watching means no timers', async () => {
    const w = world({ link: true, reachable: false })
    w.monitor.noteFailure()
    await w.settle()
    await w.pass(CONFIRM_MISS_MS)
    expect(w.monitor.get().online).toBe(false)
    const off = w.monitor.subscribe(() => {})
    await w.settle()
    off()
    expect(w.pending()).toBe(0)
    w.monitor.dispose()
  })

  it('with Cloud off nobody is asked: the link is the answer, and a dead LU Cloud changes nothing', async () => {
    const w = world({ link: true, reachable: false, cloud: false })
    w.monitor.subscribe(() => {})
    await w.settle()
    await w.pass(ONLINE_RECHECK_MS * 4)
    await w.comeBack()
    w.monitor.noteFailure()
    await w.settle()
    expect(w.state.probes).toBe(0)
    expect(w.monitor.get()).toEqual({ online: true, state: 'online' })
    expect(w.pending()).toBe(0)
    await w.setLink(false)
    expect(w.monitor.get().online).toBe(false)
    await w.setLink(true)
    expect(w.monitor.get().online).toBe(true)
    expect(w.state.probes).toBe(0)
  })

  it('switching Cloud on starts the probe, switching it off ends it', async () => {
    const w = world({ link: true, reachable: false, cloud: false })
    w.monitor.subscribe(() => {})
    await w.settle()
    w.state.cloud = true
    await w.monitor.check()
    await w.pass(CONFIRM_MISS_MS)
    expect(w.state.probes).toBe(2)
    expect(w.monitor.get().online).toBe(false)
    w.state.cloud = false
    await w.monitor.check()
    expect(w.monitor.get()).toEqual({ online: true, state: 'online' })
    const before = w.state.probes
    await w.pass(ONLINE_RECHECK_MS * 2)
    expect(w.state.probes).toBe(before)
  })

  it('downloads and everything local hang on the phone network alone, never on LU Cloud', () => {
    const local = [
      'screens/models/ModelsPage.tsx',
      'screens/models/DownloadsPage.tsx',
      'screens/models/parts/Transfer.tsx',
      'screens/models/parts/start-download.ts',
      'screens/models/parts/watch.ts',
      'screens/onboarding/SetupModelPage.tsx',
      'screens/onboarding/SetupDocumentsPage.tsx',
      'screens/onboarding/SetupDonePage.tsx',
    ]
    for (const file of local) {
      const src = readFileSync(resolve(__dirname, '../../..', file), 'utf8')
      expect(src, file).not.toMatch(/useCloudOnline|useOnlineState|isConfirmedOnline/)
    }
    const hook = readFileSync(resolve(__dirname, '../../../resilience/useOnline.ts'), 'utf8')
    const body = hook.slice(hook.indexOf('export function useOnline()'), hook.indexOf('export function useCloudOnline()'))
    expect(body).toContain('linkNow')
    // linkNow: navigator.onLine, or what the system said to recheckOnline. Never a probe.
    const linkNow = hook.slice(hook.indexOf('function linkNow()'), hook.indexOf('function subscribeLink('))
    expect(linkNow).toContain('systemSays ?? linkExists()')
    expect(linkNow).not.toMatch(/shared\(\)|probeNetwork/)
    expect(body).not.toMatch(/shared\(\)|probeNetwork/)
    expect(hook).toContain('probeWanted: cloudIsOn')
  })

  it('asks the cloud front page in the app and a file of the app in a browser', () => {
    expect(probeUrl(false, 'http://localhost:5173')).toBe('http://localhost:5173/LU-monogram.svg')
    expect(probeUrl(true, 'tauri://localhost')).toMatch(/^https:\/\/[^/]+\/$/)
  })
})

describe('the notice after a return', () => {
  const now = 1_000_000_000
  const cut = (id: string, over: Record<string, unknown> = {}) => ({ id, role: 'assistant', content: 'half', timestamp: now - 1000, finishReason: INTERRUPTED_FINISH_REASON, ...over })
  const conv = (id: string, messages: unknown[]) => ({ id, title: `Chat ${id}`, messages }) as never

  it('finds an answer that was cut, once per chat, as long as it is the last thing in it', () => {
    const list = [
      conv('a', [{ id: 'u1', role: 'user', content: 'q', timestamp: 1 }, cut('m1')]),
      conv('b', [cut('m2'), { id: 'u2', role: 'user', content: 'went on', timestamp: 2 }]),
      conv('c', [cut('m3'), { id: 'h', role: 'user', content: 'hidden', hidden: true, timestamp: 3 }]),
      conv('d', [{ id: 'm4', role: 'assistant', content: 'whole', timestamp: 4 }]),
    ]
    expect(interruptedReplies(list, new Set(), now)).toEqual([
      { conversationId: 'a', messageId: 'm1', title: 'Chat a', partial: true },
      { conversationId: 'c', messageId: 'm3', title: 'Chat c', partial: true },
    ])
  })

  it('knows an answer of which nothing had arrived, so the notice does not claim a saved part', () => {
    const empty = [conv('a', [cut('m1', { content: INTERRUPTED_EMPTY_TEXT })]), conv('b', [cut('m2', { content: INTERRUPTED_EMPTY_TEXT, thinking: 'Let me see' })])]
    expect(interruptedReplies(empty, new Set(), now).map((r) => r.partial)).toEqual([false, true])
  })

  // Round 9, N9 on Android: closed while the agent read a page, before the first word of the answer. The box
  // under the answer said "had not started yet", this notice "saved up to that point".
  it('a step the agent ran is not a part of the answer: the notice says what the box under the answer says', () => {
    const step = { id: 'b1', phase: 'tool_call', content: '', timestamp: 1, toolCalls: [{ id: 't1', toolName: 'web_fetch' }] }
    const written = { id: 'b2', phase: 'answer', content: 'Iceland has', timestamp: 2 }
    const list = [
      conv('a', [cut('m1', { content: INTERRUPTED_EMPTY_TEXT, agentBlocks: [step] })]),
      conv('b', [cut('m2', { content: '', agentBlocks: [step, { ...written, content: '  ' }] })]),
      conv('c', [cut('m3', { content: '', agentBlocks: [step, written] })]),
    ]
    const found = interruptedReplies(list, new Set(), now)
    expect(found.map((r) => r.partial)).toEqual([false, false, true])
    expect(resumeText([found[0]], 'a')).toBe('Nothing of the answer was saved yet. Ask again to get it.')
    expect(resumeText([found[2]], 'c')).toBe('The answer is saved up to that point.')
  })

  it('says it once, and not at all when it is old news', () => {
    const list = [conv('a', [cut('m1')]), conv('b', [cut('m2', { timestamp: now - RESUME_MAX_AGE_MS - 1 })])]
    expect(interruptedReplies(list, new Set(), now).map((r) => r.messageId)).toEqual(['m1'])
    expect(interruptedReplies(list, new Set(['m1']), now)).toEqual([])
  })

  it('names the chat it is about when a different chat is on the screen (acceptance Android, N13)', () => {
    const one = [{ conversationId: 'a', messageId: 'm1', title: 'Trip plan', partial: false }]
    // No chat open, or the chat it is about: the plain sentence.
    expect(resumeText(one, '')).toBe('Nothing of the answer was saved yet. Ask again to get it.')
    expect(resumeText(one, 'a')).toBe('Nothing of the answer was saved yet. Ask again to get it.')
    // Another chat is open: the notice must not read as news about that one.
    expect(resumeText(one, 'b')).toBe('Nothing of the answer was saved yet. Ask again to get it. It belongs to another chat: Trip plan.')
    expect(resumeText([{ ...one[0], partial: true }], 'b')).toBe('The answer is saved up to that point. It belongs to another chat: Trip plan.')
    expect(resumeText([{ ...one[0], title: '  ' }], 'b')).toMatch(/It belongs to another chat\.$/)
    // A long title is cut, the notice stays slim.
    const long = resumeText([{ ...one[0], title: 'x'.repeat(200) }], 'b')
    expect(long).toContain(`${'x'.repeat(RESUME_TITLE_MAX - 3)}...`)
    expect(long).not.toContain('x'.repeat(RESUME_TITLE_MAX))
    // Several: the count, no single chat to name.
    // Second check on Android, F9: nothing had arrived of either, and the notice said "what had arrived of them is saved".
    const two = [...one, { ...one[0], conversationId: 'c', messageId: 'm2' }]
    // Checks on Android with 4 GB (F7) and on the iPhone (M4): the number counts only answers a part is saved of.
    expect(resumeShown(two)).toEqual([two[0]])
    expect(resumeText(resumeShown(two), 'b')).toBe('Nothing of the answer was saved yet. Ask again to get it. It belongs to another chat: Trip plan.')
    // A part of one of them is there: the notice is about that one, and says no number.
    const mixed = [two[0], { ...two[1], partial: true }]
    expect(resumeShown(mixed)).toEqual([mixed[1]])
    expect(resumeText(resumeShown(mixed), 'c')).toBe('The answer is saved up to that point.')
    // Seven cut answers over seven starts, two of them with a part: "2", never "7".
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...one[0], conversationId: `c${i}`, messageId: `m${i}`, partial: i === 2 || i === 5 }))
    expect(resumeShown(seven).map((r) => r.messageId)).toEqual(['m2', 'm5'])
    expect(resumeText(resumeShown(seven), '')).toBe('2 answers were cut short. What had arrived of them is saved.')
    expect(resumeText([], 'b')).toBe('')
    expect(resumeShown([])).toEqual([])
  })

  it('a cut answer whose chat is on screen is done with: the box under the answer says it there', () => {
    const found = [
      { conversationId: 'a', messageId: 'm1', title: 'Trip plan', partial: true },
      { conversationId: 'b', messageId: 'm2', title: 'Tides', partial: false },
    ]
    expect(seenByOpening(found, 'a')).toEqual(['m1'])
    expect(seenByOpening(found, 'b')).toEqual(['m2'])
    expect(seenByOpening(found, 'other')).toEqual([])
    expect(seenByOpening(found, '')).toEqual([])
  })

  it('what the notice has shown is remembered for the next start at once, so it does not count up over starts', () => {
    const source = readFileSync(resolve(__dirname, '..', '..', '..', 'resilience', 'ResumeNotice.tsx'), 'utf8')
    expect(source).toContain('writeSeen(withSeen(readSeen(), allIds))')
    expect(source).toContain('const opened = seenByOpening(all, openChatId)')
    expect(source).toContain('writeSeen(withSeen(readSeen(), opened))')
    expect(source).toContain('{resumeText(found, openChatId)}')
    expect(source).toContain('const found = useMemo(() => resumeShown(rest), [rest])')
  })

  it('keeps a bounded memory of what was said', () => {
    expect(withSeen(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    const many = Array.from({ length: RESUME_SEEN_MAX + 10 }, (_, i) => `id-${i}`)
    const kept = withSeen(many, ['new'])
    expect(kept).toHaveLength(RESUME_SEEN_MAX)
    expect(kept.at(-1)).toBe('new')
  })

  it('counts only jobs that were booked before the app went away, each once', () => {
    const jobs = [
      { id: 'old', startedAt: 100 },
      { id: 'said', startedAt: 100 },
      { id: 'fresh', startedAt: 900 },
    ] as never
    expect(pickedUpJobs(jobs, new Set(['said']), 500).map((j) => j.id)).toEqual(['old'])
  })
})

describe('the report of the error screen', () => {
  it('names the error and the figures of the device, and never throws', () => {
    const report = buildFatalReport(new TypeError('boom'))
    expect(report.startsWith('LU error report\nError: TypeError: boom')).toBe(true)
    expect(report).toContain('Stack:')
    expect(report).toContain('LU diagnostics')
    expect(buildFatalReport('plain text')).toContain('Error: plain text')
    expect(buildFatalReport(undefined)).toContain('Error: unknown')
    expect(buildFatalReport({ toString: () => { throw new Error('no') } })).toContain('Error: unknown')
  })

  it('cuts a long stack, so the report stays something a person can paste', () => {
    const err = new Error('deep')
    err.stack = Array.from({ length: 80 }, (_, i) => `    at frame${i}`).join('\n')
    const stack = buildFatalReport(err).split('Stack:\n')[1].split('\n\n')[0]
    expect(stack.split('\n').length).toBeLessThanOrEqual(13)
  })
})

// Check on Android with 4 GB, F1. The measurement is in e2e/mobile/chat.mobile.ts (360x640 and 320x568 with the keyboard).
describe('the notice after a return gives its room to the keyboard', () => {
  it('the box folds away while the keyboard is open, its frame keeps the top safe area', () => {
    const css = readFileSync(resolve(__dirname, '..', '..', '..', 'styles', 'base.css'), 'utf8')
    expect(css).toMatch(/html\.m-kb-open \.m-resume-alert \.m-note \{\s*display: none;\s*\}/)
    // The frame itself is not hidden: `.m-app:has(> .m-storage-alert) .m-stack` takes the top padding from the pages.
    expect(css).not.toMatch(/html\.m-kb-open \.m-resume-alert \{/)
    const notice = readFileSync(resolve(__dirname, '..', '..', '..', 'resilience', 'ResumeNotice.tsx'), 'utf8')
    expect(notice).toContain('className="m-storage-alert m-storage-alert--slim m-resume-alert"')
  })
})
