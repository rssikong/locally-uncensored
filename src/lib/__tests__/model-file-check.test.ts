/**
 * Check files and Repair, the rules (GH #113, wish G16): which files a check
 * asks about, what each verdict says, and what Repair does with it, proven
 * with stand-ins for the Trash and the download.
 *
 * Run: npx vitest run src/lib/__tests__/model-file-check.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import {
  bundleCheckTargets, chatModelCheckTargets, chatModelCheckable, checkPercent, checkSummary,
  filesToRepair, repairFiles, repairStepFor, repairSummary, stateDetail, stateLabel, stateTone,
  type CheckTarget,
} from '../model-file-check'
import type { FileState, FileVerdict } from '../../api/model-verify'
import { getVideoBundles } from '../../api/model-bundles'

const GIB = 1_073_741_824

const v = (filename: string, state: FileState, extra: Partial<FileVerdict> = {}): FileVerdict => ({
  filename, state, actualBytes: 0, expectedBytes: null, partialBytes: null, checked: 'none', ...extra,
})

describe('which files a check asks about', () => {
  it('takes every fetchable bundle file, the exact size only where the catalog knows it', () => {
    const t = bundleCheckTargets([
      { filename: 'a.safetensors', subfolder: 'vae', downloadUrl: 'https://h/a', sizeBytes: 123, sha256: 'ab'.repeat(32) },
      { filename: 'b.safetensors', subfolder: 'text_encoders', downloadUrl: 'https://h/b', sizeGB: 2 },
      { filename: 'c.safetensors', subfolder: 'vae' },
    ])
    expect(t.map((x) => x.filename)).toEqual(['a.safetensors', 'b.safetensors'])
    expect(t[0]).toMatchObject({ subfolder: 'vae', url: 'https://h/a', expectedBytes: 123, downloadBytes: 123, sha256: 'ab'.repeat(32) })
    // A rounded GB is never handed to the check as the size to match.
    expect(t[1].expectedBytes).toBeUndefined()
    expect(t[1].downloadBytes).toBe(2 * GIB)
  })

  it('covers a real multi file video bundle from the catalog', () => {
    const bundle = getVideoBundles().find((b) => b.files.length >= 3 && b.files.every((f) => f.downloadUrl && f.subfolder))!
    const t = bundleCheckTargets(bundle.files)
    expect(t).toHaveLength(bundle.files.length)
    expect(t.every((x) => x.subfolder && x.url && !x.destDir)).toBe(true)
  })

  it('checks a chat model with its image part, the part as optional', () => {
    const t = chatModelCheckTargets({
      filename: 'M.Q4_K_M.gguf', downloadUrl: 'https://h/m', sizeBytes: 10, sha256: 'cd'.repeat(32),
      mmprojUrl: 'https://h/p', mmprojBytes: 5, mmprojSha256: 'ef'.repeat(32),
    }, '/models')
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ filename: 'M.Q4_K_M.gguf', destDir: '/models', expectedBytes: 10 })
    expect(t[0].optional).toBeFalsy()
    expect(t[1]).toMatchObject({ destDir: '/models', url: 'https://h/p', expectedBytes: 5, sha256: 'ef'.repeat(32), optional: true })
    expect(t[1].filename).toMatch(/mmproj/i)
    expect(chatModelCheckTargets({ filename: 'x.gguf' }, '/m')).toEqual([])
  })

  it('offers the check only for a built-in engine file that is the catalog file by name', () => {
    const m = { filename: 'Qwen3-8B.Q4_K_M.gguf', downloadUrl: 'https://h/q' }
    expect(chatModelCheckable(m, { name: 'Qwen3-8B.Q4_K_M' }, true)).toBe(true)
    expect(chatModelCheckable(m, { name: '/x/qwen3-8b.q4_k_m.gguf' }, true)).toBe(true)
    // Another quant, another store, no entry, a split model: no button.
    expect(chatModelCheckable(m, { name: 'Qwen3-8B.Q8_0' }, true)).toBe(false)
    expect(chatModelCheckable(m, { name: 'Qwen3-8B.Q4_K_M' }, false)).toBe(false)
    expect(chatModelCheckable(m, null, true)).toBe(false)
    expect(chatModelCheckable({ filename: 'big-00001-of-00003.gguf', downloadUrl: 'https://h' }, { name: 'big-00001-of-00003' }, true)).toBe(false)
  })
})

describe('what a verdict means', () => {
  it('trashes only a file that is there and wrong, and leaves an optional missing part alone', () => {
    expect(repairStepFor('ok')).toBe('none')
    expect(repairStepFor('unconfirmed')).toBe('none')
    expect(repairStepFor('missing')).toBe('fetch')
    expect(repairStepFor('missing', true)).toBe('none')
    expect(repairStepFor('incomplete')).toBe('fetch')
    expect(repairStepFor('wrong_size')).toBe('trash-and-fetch')
    expect(repairStepFor('wrong_checksum')).toBe('trash-and-fetch')
  })

  it('names every state on screen, red only for damage', () => {
    const states: FileState[] = ['ok', 'missing', 'wrong_size', 'wrong_checksum', 'incomplete', 'unconfirmed']
    expect(states.map((s) => stateLabel(s))).toEqual(['OK', 'Missing', 'Wrong size', 'Checksum mismatch', 'Incomplete download', 'Not confirmed'])
    expect(stateLabel('missing', true)).toBe('Not added')
    expect(states.map((s) => stateTone(s))).toEqual(['good', 'bad', 'bad', 'bad', 'bad', 'calm'])
    expect(stateTone('missing', true)).toBe('calm')
    for (const s of states) {
      const line = stateDetail(v('f', s, { actualBytes: 5 * GIB, expectedBytes: 7 * GIB, partialBytes: 2 * GIB }))
      expect(line.length).toBeGreaterThan(0)
      expect(line).not.toMatch(/[\u2013\u2014]/)
    }
    expect(stateDetail(v('f', 'wrong_size', { actualBytes: 5 * GIB, expectedBytes: 7 * GIB }))).toBe('5.0 GB on disk, 7.0 GB expected.')
    expect(stateDetail(v('f', 'incomplete', { expectedBytes: 7 * GIB, partialBytes: 2 * GIB }))).toBe('2.0 GB of 7.0 GB downloaded.')
    expect(stateDetail(v('f', 'ok', { checked: 'sha256' }))).toBe('Size and checksum match.')
  })

  it('sums the check up in one sentence', () => {
    const t: CheckTarget[] = [{ filename: 'a' }, { filename: 'b' }, { filename: 'c', optional: true }]
    expect(checkSummary(t, [v('a', 'ok'), v('b', 'ok'), v('c', 'ok')])).toBe('All 3 files are OK.')
    expect(checkSummary(t.slice(0, 1), [v('a', 'ok')])).toBe('The file is OK.')
    expect(checkSummary(t, [v('a', 'wrong_size'), v('b', 'ok'), v('c', 'missing')])).toBe('1 of 3 files needs a repair.')
    expect(checkSummary(t, [v('a', 'ok'), v('b', 'unconfirmed'), v('c', 'ok')])).toBe('Nothing to repair. 1 file could not be confirmed.')
    expect(checkPercent(50, 200)).toBe(25)
    expect(checkPercent(5, 0)).toBe(0)
    expect(checkPercent(300, 200)).toBe(100)
  })
})

describe('Repair', () => {
  const targets: CheckTarget[] = [
    { filename: 'ok.safetensors', subfolder: 'vae', url: 'u1' },
    { filename: 'gone.safetensors', subfolder: 'vae', url: 'u2' },
    { filename: 'bad.safetensors', subfolder: 'vae', url: 'u3' },
    { filename: 'half.safetensors', subfolder: 'vae', url: 'u4' },
    { filename: 'part.mmproj.gguf', destDir: '/m', url: 'u5', optional: true },
  ]
  const verdicts = [
    v('ok.safetensors', 'ok'),
    v('gone.safetensors', 'missing'),
    v('bad.safetensors', 'wrong_checksum'),
    v('half.safetensors', 'incomplete'),
    v('part.mmproj.gguf', 'missing'),
  ]

  it('fetches only the broken files, a wrong one after it went to the Trash', async () => {
    const calls: string[] = []
    const deps = {
      trash: vi.fn(async (t: CheckTarget) => { calls.push(`trash ${t.filename}`) }),
      start: vi.fn(async (t: CheckTarget) => { calls.push(`start ${t.filename}`); return { status: 'started' } }),
    }
    expect(filesToRepair(targets, verdicts).map((x) => x.target.filename)).toEqual(['gone.safetensors', 'bad.safetensors', 'half.safetensors'])
    const report = await repairFiles(targets, verdicts, deps)
    expect(calls).toEqual([
      'start gone.safetensors',
      'trash bad.safetensors',
      'start bad.safetensors',
      'start half.safetensors',
    ])
    expect(report).toEqual({ started: ['gone.safetensors', 'bad.safetensors', 'half.safetensors'], trashed: ['bad.safetensors'], failed: [] })
    expect(repairSummary(report)).toBe('3 files are downloading again. Check again when the download list says done. The broken file is in the Trash.')
    expect(repairSummary(report, 'Recycle Bin')).toContain('in the Recycle Bin.')
  })

  it('never downloads over a file the Trash refused', async () => {
    const deps = {
      trash: vi.fn(async () => { throw new Error('Could not move bad.safetensors to the Trash: busy') }),
      start: vi.fn(async () => ({ status: 'started' })),
    }
    const report = await repairFiles(targets, [v('bad.safetensors', 'wrong_size')], deps)
    expect(deps.start).not.toHaveBeenCalled()
    expect(report.failed).toEqual([{ filename: 'bad.safetensors', error: 'Could not move bad.safetensors to the Trash: busy' }])
    expect(repairSummary(report)).toBe('1 file could not be repaired.')
  })

  it('reports a start the backend refused and goes on with the next file', async () => {
    const deps = {
      trash: vi.fn(async () => ({})),
      start: vi.fn(async (t: CheckTarget) => (t.filename === 'gone.safetensors'
        ? { status: 'error', error: 'Not enough free space' }
        : { status: 'started' })),
    }
    const report = await repairFiles(targets, [v('gone.safetensors', 'missing'), v('half.safetensors', 'incomplete')], deps)
    expect(report.failed).toEqual([{ filename: 'gone.safetensors', error: 'Not enough free space' }])
    expect(report.started).toEqual(['half.safetensors'])
  })

  it('has nothing to do when everything is whole', async () => {
    const deps = { trash: vi.fn(), start: vi.fn() }
    const report = await repairFiles(targets, [v('ok.safetensors', 'ok'), v('part.mmproj.gguf', 'missing')], deps)
    expect(deps.trash).not.toHaveBeenCalled()
    expect(deps.start).not.toHaveBeenCalled()
    expect(repairSummary(report)).toBe('Nothing to repair.')
  })
})
