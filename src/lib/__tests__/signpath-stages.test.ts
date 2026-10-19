/**
 * The staged SignPath lane, executed: scripts/signpath-stages.mjs.
 *
 * A production signing request waits for a person, so no job waits for it.
 * Each stage leaves a state artifact, and `plan` and `watch` decide from those
 * and from SignPath's answer what happens next. Here both services are played
 * by a local HTTP server: GitHub (artifacts, releases, runs, dispatches) and
 * the SignPath connector (status, signed artifact). The commands run as the
 * workflows run them, as separate processes, against that server.
 *
 * What is held: a stage started twice submits once; a waiting request starts
 * nothing; an approval starts exactly the next stage, on the release tag; a
 * denied request stops the chain with the command that submits it again;
 * nothing published is published again; the tokens never reach the log.
 *
 * VERIFICATION LIMIT, stated on purpose: the answers of the stand-in follow
 * the SignPath GitHub action v3.0 (status fields `status` and
 * `isFinalStatus`, read in its index.js at the pinned commit) and the GitHub
 * REST API. The first real answer comes with a run of signpath-probe.yml.
 *
 * Run: npx vitest run src/lib/__tests__/signpath-stages.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { crc32, deflateRawSync } from 'node:zlib'
import {
  checkProvenance, classify, currentChain, llamaPin, nextAction, planStage, provenanceOf, readZip, releaseTagOf,
  stateArtifactName,
} from '../../../scripts/signpath-stages.mjs'
import { zipOfOneFile } from '../../../scripts/windows-signpath.mjs'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const SCRIPT = resolve(root, 'scripts/signpath-stages.mjs')

/** A ZIP archive with deflated entries, the way GitHub and SignPath hand them out. */
function zipOf(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, data } of files) {
    const packed = deflateRawSync(data)
    const fileName = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(fileName.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, fileName, packed)
    centrals.push(central, fileName)
    offset += local.length + fileName.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const state = (step: string, fields: Record<string, unknown>) => ({ schema: 1, label: 'v9.9.9', step, ...fields })
const status = (s: string, final: boolean) => ({ status: s, isFinalStatus: final })

describe('names, refs and the chain', () => {
  it('names one artifact per step and label', () => {
    expect(stateArtifactName('v3.0.7', 'app')).toBe('signpath-state-v3.0.7-1-app')
    expect(stateArtifactName('v3.0.7', 'installers')).toBe('signpath-state-v3.0.7-2-installers')
    expect(stateArtifactName('probe-123', 'published')).toBe('signpath-state-probe-123-3-published')
    expect(() => stateArtifactName('v3.0.7', 'other')).toThrow(/unknown step/)
    expect(() => stateArtifactName('../x', 'app')).toThrow(/no usable label/)
  })

  it('knows a release tag ref and nothing else', () => {
    expect(releaseTagOf('refs/tags/v3.0.7')).toBe('v3.0.7')
    for (const no of ['refs/heads/master', 'refs/tags/v3.0.7-rc1', 'refs/tags/v3.0', 'v3.0.7', '']) expect(releaseTagOf(no), no).toBeNull()
  })

  it('a later step counts only when it names the request before it', () => {
    const app = state('app', { requestId: 'A2' })
    const stale = state('installers', { requestId: 'I1', appRequestId: 'A1' })
    expect(currentChain({ app, installers: stale })).toEqual({ app, installers: null, published: null })
    const installers = state('installers', { requestId: 'I2', appRequestId: 'A2' })
    const published = state('published', { installersRequestId: 'I2' })
    expect(currentChain({ app, installers, published })).toEqual({ app, installers, published })
    expect(currentChain({ installers, published })).toEqual({ app: null, installers: null, published: null })
  })

  it('reads a SignPath status as completed, waiting or ended', () => {
    expect(classify(status('Completed', true))).toBe('completed')
    for (const s of ['Denied', 'Failed', 'Canceled']) expect(classify(status(s, true)), s).toBe('ended')
    for (const s of ['WaitingForApproval', 'InProgress', 'QueuedForProcessing']) expect(classify(status(s, false)), s).toBe('waiting')
    expect(classify(null)).toBe('ended')
  })
})

describe('plan: does a stage run', () => {
  const app = state('app', { requestId: 'A1', requestUrl: 'https://sp/A1' })
  const installers = state('installers', { requestId: 'I1', requestUrl: 'https://sp/I1', appRequestId: 'A1' })
  const published = state('published', { installersRequestId: 'I1' })
  const answers = (map: Record<string, unknown>) => async (id: string) => (map[id] ?? null) as never

  it('build: submits when nothing was submitted, or the last request ended', async () => {
    expect((await planStage('build', 'v9.9.9', currentChain({}), answers({}))).run).toBe(true)
    for (const [s, final, runs] of [['WaitingForApproval', false, false], ['Completed', true, false], ['Denied', true, true], ['Canceled', true, true]] as const) {
      const verdict = await planStage('build', 'v9.9.9', currentChain({ app }), answers({ A1: status(s, final) }))
      expect(verdict.run, s).toBe(runs)
      expect(verdict.level, s).toBe('notice')
    }
  })

  it('app: submits again only after a request that ended, and needs stage 1', async () => {
    expect(await planStage('app', 'v9.9.9', currentChain({}), answers({}))).toMatchObject({ run: false, level: 'error' })
    expect((await planStage('app', 'v9.9.9', currentChain({ app }), answers({ A1: status('Denied', true) }))).run).toBe(true)
    expect(await planStage('app', 'v9.9.9', currentChain({ app }), answers({ A1: status('WaitingForApproval', false) }))).toMatchObject({ run: false, level: 'notice' })
  })

  it('installers: waits for the app binary, stops on a denial, submits once', async () => {
    expect(await planStage('installers', 'v9.9.9', currentChain({}), answers({}))).toMatchObject({ run: false, level: 'error' })
    expect(await planStage('installers', 'v9.9.9', currentChain({ app }), answers({ A1: status('WaitingForApproval', false) })))
      .toMatchObject({ run: false, level: 'notice' })
    const denied = await planStage('installers', 'v9.9.9', currentChain({ app }), answers({ A1: status('Denied', true) }))
    expect(denied).toMatchObject({ run: false, level: 'error' })
    expect(denied.message).toContain('gh workflow run windows-signpath.yml --ref v9.9.9 -f stage=app')
    const signed = { A1: status('Completed', true) }
    expect((await planStage('installers', 'v9.9.9', currentChain({ app }), answers(signed))).run).toBe(true)
    expect(await planStage('installers', 'v9.9.9', currentChain({ app, installers }), answers({ ...signed, I1: status('WaitingForApproval', false) })))
      .toMatchObject({ run: false, level: 'notice' })
    expect((await planStage('installers', 'v9.9.9', currentChain({ app, installers }), answers({ ...signed, I1: status('Failed', true) }))).run).toBe(true)
  })

  it('publish: waits for the installers, stops on a denial, never publishes twice', async () => {
    const signed = { A1: status('Completed', true) }
    expect(await planStage('publish', 'v9.9.9', currentChain({ app }), answers(signed))).toMatchObject({ run: false, level: 'error' })
    expect(await planStage('publish', 'v9.9.9', currentChain({ app, installers }), answers({ ...signed, I1: status('WaitingForApproval', false) })))
      .toMatchObject({ run: false, level: 'notice' })
    const denied = await planStage('publish', 'v9.9.9', currentChain({ app, installers }), answers({ ...signed, I1: status('Denied', true) }))
    expect(denied).toMatchObject({ run: false, level: 'error' })
    expect(denied.message).toContain('gh workflow run windows-signpath.yml --ref v9.9.9 -f stage=installers')
    expect((await planStage('publish', 'v9.9.9', currentChain({ app, installers }), answers({ ...signed, I1: status('Completed', true) }))).run).toBe(true)
    // Published already: not even SignPath is asked.
    const verdict = await planStage('publish', 'v9.9.9', currentChain({ app, installers, published }), async () => { throw new Error('asked') })
    expect(verdict).toMatchObject({ run: false, level: 'notice' })
    expect(verdict.message).toContain('Nothing is overwritten')
  })

  it('a probe is told to continue with the probe workflow', async () => {
    const probeApp = { ...app, label: 'probe-42' }
    const verdict = await planStage('installers', 'probe-42', currentChain({ app: probeApp }), answers({ A1: status('Denied', true) }))
    expect(verdict.message).toContain('gh workflow run signpath-probe.yml --ref <branch> -f stage=build -f label=probe-42')
  })
})

describe('the watcher, one chain', () => {
  const app = state('app', { requestId: 'A1', requestUrl: 'https://sp/A1' })
  const installers = state('installers', { requestId: 'I1', requestUrl: 'https://sp/I1', appRequestId: 'A1' })
  const answers = (map: Record<string, unknown>) => async (id: string) => (map[id] ?? null) as never

  it('starts the next stage when a request is completed, and only then', async () => {
    expect(await nextAction('v9.9.9', currentChain({}), answers({}))).toMatchObject({ action: 'none' })
    expect(await nextAction('v9.9.9', currentChain({ app }), answers({ A1: status('WaitingForApproval', false) }))).toMatchObject({ action: 'wait' })
    expect(await nextAction('v9.9.9', currentChain({ app }), answers({ A1: status('Completed', true) }))).toMatchObject({ action: 'dispatch', stage: 'installers' })
    expect(await nextAction('v9.9.9', currentChain({ app, installers }), answers({ I1: status('Completed', true) }))).toMatchObject({ action: 'dispatch', stage: 'publish' })
    const published = state('published', { installersRequestId: 'I1' })
    expect(await nextAction('v9.9.9', currentChain({ app, installers, published }), answers({}))).toMatchObject({ action: 'done' })
  })

  it('does not start a stage that is running already', async () => {
    expect(await nextAction('v9.9.9', currentChain({ app }), answers({ A1: status('Completed', true) }), new Set(['installers'])))
      .toMatchObject({ action: 'running', stage: 'installers' })
  })

  it('restarts nothing after a denial, and says how to submit again', async () => {
    const ended = await nextAction('v9.9.9', currentChain({ app, installers }), answers({ I1: status('Denied', true) }))
    expect(ended).toMatchObject({ action: 'ended', step: 'installers' })
    expect(ended.message).toContain('`gh workflow run windows-signpath.yml --ref v9.9.9 -f stage=installers`')
    const gone = await nextAction('v9.9.9', currentChain({ app }), answers({}))
    expect(gone.message).toContain('"not found"')
    expect(gone.message).toContain('-f stage=app')
  })
})

describe('ZIP archives from GitHub and SignPath', () => {
  it('reads deflated and stored entries, directories included', () => {
    const files = [{ name: 'nsis/app.exe', data: Buffer.from('signed nsis build') }, { name: 'msi/app.exe', data: Buffer.alloc(5000, 7) }]
    expect(readZip(zipOf(files)).map((f: { name: string; data: Buffer }) => [f.name, f.data.toString('hex')]))
      .toEqual(files.map((f) => [f.name, f.data.toString('hex')]))
    expect(readZip(zipOfOneFile('a.msi', Buffer.from('stored')))[0].data.toString()).toBe('stored')
  })

  it('refuses a name that leaves the directory, and a damaged entry', () => {
    expect(() => readZip(zipOf([{ name: '../evil.exe', data: Buffer.from('x') }]))).toThrow(/outside its directory/)
    expect(() => readZip(zipOf([{ name: '/abs.exe', data: Buffer.from('x') }]))).toThrow(/outside its directory/)
    const broken = zipOf([{ name: 'a', data: Buffer.from('payload payload') }])
    broken.writeUInt32LE(0, 14)
    broken.writeUInt32LE(0, broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16)
    expect(() => readZip(broken)).toThrow(/damaged/)
    expect(() => readZip(Buffer.from('not a zip at all, not at all'))).toThrow(/not a ZIP/)
  })
})

describe('the llama.cpp provenance record', () => {
  let repo = ''
  const triple = 'x86_64-pc-windows-msvc'
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'provenance-'))
    mkdirSync(join(repo, 'scripts'))
    writeFileSync(join(repo, 'scripts/build-llama.sh'), readFileSync(join(root, 'scripts/build-llama.sh')))
    mkdirSync(join(repo, 'src-tauri/bin'), { recursive: true })
    mkdirSync(join(repo, `src-tauri/resources/llama/${triple}`), { recursive: true })
    writeFileSync(join(repo, `src-tauri/bin/lu-llama-server-${triple}.exe`), 'server')
    for (const dll of ['llama.dll', 'ggml-cpu-haswell.dll', 'ggml-vulkan.dll']) writeFileSync(join(repo, `src-tauri/resources/llama/${triple}`, dll), dll)
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it('names license, source, the pinned version and commit, and the sha256 of every shipped file', () => {
    const pin = llamaPin(readFileSync(join(root, 'scripts/build-llama.sh'), 'utf8'))
    expect(pin.repository).toBe('https://github.com/ggml-org/llama.cpp')
    const record = provenanceOf(repo, triple, { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '77', GITHUB_SHA: 'abc' })
    expect(record).toMatchObject({
      component: 'llama.cpp', license: 'MIT', source: pin.repository, version: pin.tag, commit: pin.commit,
      licenseText: `${pin.repository}/blob/${pin.commit}/LICENSE`, buildRun: 'https://github.com/o/r/actions/runs/77', signed: false,
    })
    expect(record.files.map((f: { installedAs: string }) => f.installedAs)).toEqual(['lu-llama-server.exe', 'ggml-cpu-haswell.dll', 'ggml-vulkan.dll', 'llama.dll'])
    expect(record.files[0]).toEqual({
      installedAs: 'lu-llama-server.exe', source: `src-tauri/bin/lu-llama-server-${triple}.exe`, size: 6,
      sha256: createHash('sha256').update('server').digest('hex'),
    })
    expect(record.files.every((f: { sha256: string }) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true)
    expect(checkProvenance(repo, record)).toBe(4)
  })

  it('notices a changed, an added and a missing file', () => {
    const record = provenanceOf(repo, triple)
    writeFileSync(join(repo, `src-tauri/resources/llama/${triple}/llama.dll`), 'other')
    expect(() => checkProvenance(repo, record)).toThrow(/llama\.dll has sha256/)
    writeFileSync(join(repo, `src-tauri/resources/llama/${triple}/llama.dll`), 'llama.dll')
    writeFileSync(join(repo, `src-tauri/resources/llama/${triple}/extra.dll`), 'x')
    expect(() => checkProvenance(repo, record)).toThrow(/differ from the record/)
    rmSync(join(repo, `src-tauri/resources/llama/${triple}/extra.dll`))
    mkdirSync(join(repo, 'src-tauri/target/release'), { recursive: true })
    writeFileSync(join(repo, 'src-tauri/target/release/lu-llama-server.exe'), 'server')
    expect(checkProvenance(repo, record)).toBe(4)
    writeFileSync(join(repo, 'src-tauri/target/release/lu-llama-server.exe'), 'another server')
    expect(() => checkProvenance(repo, record)).toThrow(/is not the recorded/)
    rmSync(join(repo, `src-tauri/bin/lu-llama-server-${triple}.exe`))
    expect(() => checkProvenance(repo, record)).toThrow(/was not built/)
  })

  it('refuses to describe a build whose pin was overridden', () => {
    expect(() => provenanceOf(repo, triple, { LLAMA_COMMIT: 'f'.repeat(40) })).toThrow(/overridden/)
  })
})

// ── The commands against a stand-in for GitHub and SignPath ──────────────

type Artifact = { id: number; name: string; created_at: string; expired: boolean; files: { name: string; data: Buffer }[] }

describe('the commands, a release played through', () => {
  let server: Server
  let base = ''
  let work = ''
  let artifacts: Artifact[] = []
  let statuses: Record<string, { status: string; isFinalStatus: boolean } | 'unavailable-once'> = {}
  let signed: Record<string, Buffer> = {}
  let dispatches: { workflow: string; body: { ref: string; inputs: Record<string, string> } }[] = []
  let unfinished: string[] = []
  let clock = 0
  const GH_TOKEN = 'gh-token-SECRET-1'
  const SP_TOKEN = 'sp-token-SECRET-2'

  const send = (res: ServerResponse, code: number, body: unknown) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
    res.writeHead(code, { 'Content-Type': Buffer.isBuffer(body) ? 'application/zip' : 'application/json' })
    res.end(data)
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    if (path.startsWith('/gh/')) {
      if (req.headers.authorization !== `Bearer ${GH_TOKEN}`) return send(res, 401, { message: 'bad token' })
      const rest = path.slice('/gh/repos/o/r'.length)
      if (rest === '/actions/artifacts') {
        const name = url.searchParams.get('name')
        return send(res, 200, { artifacts: artifacts.filter((a) => a.name === name).map(({ files: _files, ...a }) => a) })
      }
      const zip = /^\/actions\/artifacts\/(\d+)\/zip$/.exec(rest)
      if (zip) return send(res, 200, zipOf(artifacts.find((a) => a.id === Number(zip[1]))!.files))
      if (rest === '/releases') return send(res, 200, [{ tag_name: 'v9.9.9' }, { tag_name: 'v9.9.8' }, { tag_name: 'nightly' }])
      if (/^\/actions\/workflows\/[^/]+\/runs$/.test(rest)) {
        return send(res, 200, { workflow_runs: unfinished.map((t) => ({ status: 'in_progress', display_title: t })) })
      }
      const dispatch = /^\/actions\/workflows\/([^/]+)\/dispatches$/.exec(rest)
      if (dispatch && req.method === 'POST') {
        let body = ''
        req.on('data', (c) => { body += c })
        req.on('end', () => {
          dispatches.push({ workflow: dispatch[1], body: JSON.parse(body) })
          res.writeHead(204).end()
        })
        return
      }
      return send(res, 404, { message: `no ${rest}` })
    }
    if (path.startsWith('/sp/')) {
      if (req.headers.authorization !== `Bearer ${SP_TOKEN}`) return send(res, 401, { message: 'bad token' })
      const m = /^\/sp\/org-1\/SigningRequests\/([^/]+)\/(Status|SignedArtifact)$/.exec(path)
      if (!m || url.searchParams.get('api-version') !== '1.0') return send(res, 404, {})
      const answer = statuses[m[1]]
      if (answer === 'unavailable-once') {
        statuses[m[1]] = { status: 'Completed', isFinalStatus: true }
        return send(res, 503, {})
      }
      if (m[2] === 'Status') return answer ? send(res, 200, { ...answer, hasArtifactBeenDownloadedBySignPathInCaseOfArtifactRetrieval: true }) : send(res, 404, {})
      return signed[m[1]] ? send(res, 200, signed[m[1]]) : send(res, 404, {})
    }
    send(res, 404, {})
  }

  beforeAll(async () => {
    server = createServer(handle)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((done) => server.close(() => done())))
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'signpath-stages-'))
    artifacts = []
    statuses = {}
    signed = {}
    dispatches = []
    unfinished = []
  })
  afterEach(() => rmSync(work, { recursive: true, force: true }))

  async function cli(args: string[], extra: Record<string, string> = {}) {
    const output = join(work, `output-${Math.random()}`)
    const summary = join(work, `summary-${Math.random()}`)
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      GITHUB_API_URL: `${base}/gh`,
      GITHUB_REPOSITORY: 'o/r',
      GH_TOKEN,
      SIGNPATH_CONNECTOR_URL: `${base}/sp`,
      SIGNPATH_ORGANIZATION_ID: 'org-1',
      SIGNPATH_API_TOKEN: SP_TOKEN,
      SIGNPATH_STAGES_RETRY_MS: '1',
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_REF: 'refs/tags/v9.9.9',
      GITHUB_SHA: 'c0ffee',
      GITHUB_RUN_ID: '1000',
      GITHUB_SERVER_URL: 'https://github.com',
      ...extra,
    }
    let code = 0
    let stdout = ''
    let stderr = ''
    try {
      ;({ stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { env, cwd: work }))
    } catch (error) {
      const e = error as { code: number; stdout: string; stderr: string }
      ;({ code, stdout, stderr } = e)
    }
    const outputs = Object.fromEntries((existsSync(output) ? readFileSync(output, 'utf8') : '').split('\n').filter(Boolean).map((l) => {
      const at = l.indexOf('=')
      return [l.slice(0, at), l.slice(at + 1)]
    }))
    expect(stdout + stderr, 'a token reached the log').not.toMatch(/SECRET/)
    return { code, stdout, stderr, outputs, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' }
  }

  /** What upload-artifact does with the directory write-state filled. */
  function upload(name: string, dir: string) {
    clock++
    artifacts.push({
      id: artifacts.length + 1, name, expired: false, created_at: `2026-10-14T10:${String(clock).padStart(2, '0')}:00Z`,
      files: readdirSync(dir).map((f) => ({ name: f, data: readFileSync(join(dir, f)) })),
    })
  }

  async function finishStage(step: 'app' | 'installers' | 'published', pairs: string[], runId: string) {
    const dir = join(work, `state-${step}-${clock}`)
    const written = await cli(['write-state', dir, 'v9.9.9', step, ...pairs], { GITHUB_RUN_ID: runId })
    expect(written.code, written.stderr).toBe(0)
    if (step !== 'published') writeFileSync(join(dir, 'llama-cpp-provenance.json'), '{"component":"llama.cpp"}\n')
    upload(written.outputs.name, dir)
    return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'))
  }

  it('waits, continues on each approval, and does every stage once', async () => {
    // Stage 1, in the release run: nothing submitted yet.
    expect((await cli(['plan', 'build', 'v9.9.9'])).outputs.run).toBe('true')
    const appState = await finishStage('app', ['requestId=A1', 'requestUrl=https://app.signpath.io/r/A1', 'version=9.9.9', 'buildRunId=1000', 'attempt=1'], '1000')
    expect(appState).toMatchObject({ label: 'v9.9.9', step: 'app', ref: 'refs/tags/v9.9.9', commit: 'c0ffee', runUrl: 'https://github.com/o/r/actions/runs/1000', attempt: 1 })
    statuses.A1 = { status: 'WaitingForApproval', isFinalStatus: false }

    // The release job run again: the request stands, nothing is built.
    const again = await cli(['plan', 'build', 'v9.9.9'])
    expect(again.outputs.run).toBe('false')
    expect(again.outputs['app-request-url']).toBe('https://app.signpath.io/r/A1')

    // The watcher, while David has not clicked yet.
    let watched = await cli(['watch'])
    expect(watched.code, watched.stderr).toBe(0)
    expect(dispatches).toEqual([])
    expect(watched.summary).toContain('v9.9.9: the app binary waits for approval, [A1](https://app.signpath.io/r/A1) is "WaitingForApproval"')
    // A stage started by hand too early does nothing, and says why.
    const early = await cli(['plan', 'installers', 'v9.9.9'])
    expect([early.code, early.outputs.run]).toEqual([0, 'false'])
    expect(early.summary).toContain('waits for approval in SignPath')

    // Approved: the watcher starts stage 2 on the tag, once.
    statuses.A1 = { status: 'Completed', isFinalStatus: true }
    watched = await cli(['watch'])
    expect(dispatches).toEqual([{ workflow: 'windows-signpath.yml', body: { ref: 'refs/tags/v9.9.9', inputs: { stage: 'installers' } } }])
    unfinished = ['SignPath installers v9.9.9']
    await cli(['watch'])
    expect(dispatches).toHaveLength(1)

    // Stage 2 runs, twice by accident: the second one finds the first.
    const plan2 = await cli(['plan', 'installers', 'v9.9.9'])
    expect(plan2.outputs).toMatchObject({ run: 'true', 'app-request-id': 'A1', 'build-run-id': '1000', version: '9.9.9' })
    await finishStage('installers', ['requestId=I1', 'requestUrl=https://app.signpath.io/r/I1', 'appRequestId=A1', 'version=9.9.9', 'buildRunId=1000'], '2000')
    statuses.I1 = { status: 'WaitingForApproval', isFinalStatus: false }
    unfinished = []
    expect((await cli(['plan', 'installers', 'v9.9.9'])).outputs.run).toBe('false')
    await cli(['watch'])
    expect(dispatches).toHaveLength(1)

    // Approved: stage 3.
    statuses.I1 = { status: 'Completed', isFinalStatus: true }
    await cli(['watch'])
    expect(dispatches.map((d) => d.body.inputs.stage)).toEqual(['installers', 'publish'])
    const chainDir = join(work, 'chain')
    const plan3 = await cli(['plan', 'publish', 'v9.9.9', chainDir])
    expect(plan3.outputs).toMatchObject({ run: 'true', 'installers-request-id': 'I1', 'installers-request-url': 'https://app.signpath.io/r/I1' })
    expect(readdirSync(join(chainDir, 'installers')).sort()).toEqual(['llama-cpp-provenance.json', 'state.json'])
    await finishStage('published', ['installersRequestId=I1', 'publisher=SignPath Foundation'], '3000')

    // Done: nothing runs again, nothing is overwritten.
    const after = await cli(['plan', 'publish', 'v9.9.9'])
    expect([after.code, after.outputs.run]).toEqual([0, 'false'])
    watched = await cli(['watch'])
    expect(dispatches).toHaveLength(2)
    expect(watched.summary).toContain('v9.9.9: published')
    expect(watched.summary).not.toContain('v9.9.8')
  })

  it('a denied request stops the chain until it is submitted again, and the old installers no longer count', async () => {
    await finishStage('app', ['requestId=A1', 'requestUrl=https://sp/A1', 'version=9.9.9', 'buildRunId=1000', 'attempt=1'], '1000')
    await finishStage('installers', ['requestId=I1', 'requestUrl=https://sp/I1', 'appRequestId=A1', 'version=9.9.9', 'buildRunId=1000'], '2000')
    statuses.A1 = { status: 'Completed', isFinalStatus: true }
    statuses.I1 = { status: 'Denied', isFinalStatus: true }

    const watched = await cli(['watch'])
    expect(dispatches).toEqual([])
    expect(watched.stdout).toContain('::warning title=SignPath request ended::v9.9.9: the request of the installers I1 ended as "Denied"')
    expect(watched.summary).toContain('`gh workflow run windows-signpath.yml --ref v9.9.9 -f stage=installers`')
    const publish = await cli(['plan', 'publish', 'v9.9.9'])
    expect(publish.code).toBe(1)
    expect(publish.stderr).toContain('::error::the request of the installers [I1](https://sp/I1) ended as "Denied"')
    // Submitting the installers again is allowed now.
    expect((await cli(['plan', 'installers', 'v9.9.9'])).outputs.run).toBe('true')

    // The app binary denied instead: stage "app" submits it again, from run 1000.
    statuses.A1 = { status: 'Denied', isFinalStatus: true }
    const resubmit = await cli(['plan', 'app', 'v9.9.9'])
    expect(resubmit.outputs).toMatchObject({ run: 'true', 'build-run-id': '1000', 'app-attempt': '1' })
    await finishStage('app', ['requestId=A2', 'requestUrl=https://sp/A2', 'version=9.9.9', 'buildRunId=1000', 'attempt=2'], '4000')
    statuses.A2 = { status: 'Completed', isFinalStatus: true }
    // The installers of A1 belong to the old chain: stage 2 runs for A2.
    const plan2 = await cli(['plan', 'installers', 'v9.9.9'])
    expect(plan2.outputs).toMatchObject({ run: 'true', 'app-request-id': 'A2', 'installers-request-id': '' })
    expect((await cli(['plan', 'app', 'v9.9.9'])).outputs.run).toBe('false')
  })

  it('an expired state artifact is no state', async () => {
    await finishStage('app', ['requestId=A1', 'requestUrl=https://sp/A1', 'version=9.9.9', 'buildRunId=1000', 'attempt=1'], '1000')
    artifacts[0].expired = true
    const plan = await cli(['plan', 'installers', 'v9.9.9'])
    expect(plan.code).toBe(1)
    expect(plan.stderr).toContain('missing or expired')
  })

  it('fetches a signed artifact only from a completed request, and survives one 503', async () => {
    signed.I1 = zipOf([{ name: 'LU_9.9.9_x64-setup.exe', data: Buffer.from('signed setup') }, { name: 'LU_9.9.9_x64_en-US.msi', data: Buffer.from('signed msi') }])
    statuses.I1 = { status: 'WaitingForApproval', isFinalStatus: false }
    const early = await cli(['download-signed', 'I1', join(work, 'out')])
    expect(early.code).toBe(1)
    expect(early.stderr).toContain('is "WaitingForApproval", not completed')
    statuses.I1 = 'unavailable-once'
    const got = await cli(['download-signed', 'I1', join(work, 'out')])
    expect(got.code, got.stderr).toBe(0)
    expect(readFileSync(join(work, 'out/LU_9.9.9_x64-setup.exe'), 'utf8')).toBe('signed setup')
    expect(readdirSync(join(work, 'out')).sort()).toEqual(['LU_9.9.9_x64-setup.exe', 'LU_9.9.9_x64_en-US.msi'])
  })

  it('the watcher of a repository without SignPath values does nothing and stays green', async () => {
    const watched = await cli(['watch'], { SIGNPATH_API_TOKEN: '', SIGNPATH_ORGANIZATION_ID: '' })
    expect(watched.code).toBe(0)
    expect(watched.summary).toContain('nothing to watch')
  })

  it('write-state refuses a state that does not name what it continues', async () => {
    const bad = await cli(['write-state', join(work, 's'), 'v9.9.9', 'installers', 'requestId=I1'])
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('needs the appRequestId')
  })
})

// ── The workflows around the commands ────────────────────────────────────

describe('windows-signpath.yml and the stage actions', () => {
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
  const STAGES = read('.github/workflows/windows-signpath.yml')
  const RELEASE = read('.github/workflows/release.yml')
  const STAGE1 = read('.github/actions/windows-signpath/action.yml')

  /** The lines of one job, by indentation: jobs sit at two spaces under `jobs:`. */
  const job = (yaml: string, name: string) => {
    const rest = yaml.slice(yaml.indexOf(`\n  ${name}:\n`) + 1)
    const end = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/)
    return end === -1 ? rest : rest.slice(0, end)
  }
  /** The steps of a block, each from its `- name:` line to the next. */
  const steps = (block: string) => block.split(/\n(?= +- name: )/).slice(1)
  const ifOf = (step: string) => /^\s+if: (.*)$/m.exec(step)?.[1] ?? ''
  const permissionsOf = (block: string) => /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(`${block}\n`)?.[1].trim().split(/\n\s*/) ?? []

  it('is started by hand or by the clock, and the watcher recognises the runs it started', () => {
    expect(STAGES).toMatch(/^on:\n {2}workflow_dispatch:\n/m)
    expect(STAGES).toMatch(/^ {2}schedule:\n {4}- cron: '7,22,37,52 \* \* \* \*'$/m)
    expect(STAGES).not.toMatch(/^ {2}(push|pull_request|release|workflow_run):/m)
    expect(STAGES).toMatch(/^ {8}options: \[watch, installers, publish, app\]$/m)
    expect(STAGES).toContain("format('SignPath {0} {1}', inputs.stage, github.ref_name)")
    const script = read('scripts/signpath-stages.mjs')
    expect(script).toContain('unfinished.includes(`SignPath ${stage} ${label}`)')
    expect(script).toContain("export const STAGES_WORKFLOW = 'windows-signpath.yml'")
  })

  it('gives each job the least it needs: only the watcher starts runs, only publish writes to the release', () => {
    expect(STAGES).toMatch(/^permissions: \{\}$/m)
    expect(permissionsOf(job(STAGES, 'watch'))).toEqual(['contents: read', 'actions: write'])
    expect(permissionsOf(job(STAGES, 'app'))).toEqual(['contents: read', 'actions: read'])
    expect(permissionsOf(job(STAGES, 'installers'))).toEqual(['contents: read', 'actions: read'])
    expect(permissionsOf(job(STAGES, 'publish'))).toEqual(['contents: write', 'actions: read'])
    expect(STAGES).not.toContain('secrets.GITHUB_TOKEN')
    for (const name of ['watch', 'app', 'installers']) expect(job(STAGES, name), name).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
    expect(job(STAGES, 'publish')).toContain('updater-private-key: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}')
  })

  it('serialises the stages of one tag', () => {
    expect(STAGES).toContain(
      "concurrency:\n  group: windows-signpath-${{ (github.event_name == 'schedule' || inputs.stage == 'watch') && 'watcher' || github.ref_name }}\n  cancel-in-progress: false\n",
    )
  })

  it('asks plan before it fetches, packs or publishes anything, and skips the rest when plan says no', () => {
    for (const stage of ['app', 'installers', 'publish']) {
      const all = steps(job(STAGES, stage))
      const plan = all.findIndex((s) => /^\s+id: plan$/m.test(s))
      expect(all[plan], stage).toMatch(new RegExp(`signpath-stages\\.mjs plan ${stage} "\\$GITHUB_REF_NAME"`))
      // Before plan: the tag lock, the checkout and Node, nothing else.
      expect(all.slice(0, plan).map((s) => s.split('\n')[0].trim()), stage).toEqual([
        '- name: SignPath signs a release tag only', '- name: Checkout repository', '- name: Setup Node.js',
      ])
      for (const step of all.slice(plan + 1)) expect(ifOf(step), `${stage}: ${step.split('\n')[0]}`).toBe("steps.plan.outputs.run == 'true'")
    }
  })

  it('pins every action it uses to a commit', () => {
    const files = ['.github/workflows/windows-signpath.yml', '.github/workflows/signpath-probe.yml',
      '.github/actions/windows-signpath/action.yml', '.github/actions/windows-signpath-installers/action.yml', '.github/actions/windows-signpath-finish/action.yml']
    for (const file of files) {
      for (const uses of read(file).match(/^\s*(?:- )?uses: (?!\.\/).*$/gm) ?? []) expect(uses, file).toMatch(/@[0-9a-f]{40} # (v\d|stable$)/)
    }
  })

  it('stage 1 in release.yml submits without waiting and may read the artifacts SignPath fetches', () => {
    expect(job(RELEASE, 'build-tauri')).toMatch(/^ {4}permissions:\n {6}contents: write\n {6}actions: read\n/m)
    const all = steps(STAGE1)
    expect(all.find((s) => /^\s+id: sign-app$/m.test(s))).toMatch(/^\s+wait-for-completion: false$/m)
    // What stage 2 and a resubmission need is kept as long as an approval may take.
    for (const name of ['windows-bundle-input', 'windows-app-unsigned']) {
      expect(all.find((s) => s.includes(`name: ${name}\n`)), name).toMatch(/^\s+retention-days: 90$/m)
    }
    expect(all.find((s) => s.includes('- name: Keep the state of stage 1'))).toMatch(/^\s+retention-days: 90$/m)
    // Plan comes first; every step that builds or submits depends on it.
    expect(all[0]).toMatch(/^\s+id: plan$/m)
    for (const step of all.slice(1, -1)) expect(ifOf(step), step.split('\n')[0]).toBe("steps.plan.outputs.run == 'true'")
  })

  it('stage 2 packs from the build of stage 1, checked against its llama.cpp record, and compiles nothing', () => {
    const text = read('.github/actions/windows-signpath-installers/action.yml')
    const fetch = text.indexOf('name: windows-bundle-input')
    const check = text.indexOf('check-provenance src-tauri/target/signpath/llama-cpp-provenance.json')
    const bundle = text.indexOf('npx tauri bundle')
    expect(fetch).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(fetch)
    expect(bundle).toBeGreaterThan(check)
    expect(text).not.toMatch(/tauri build|build-llama|cargo build|actions\/cache@|rust-cache/)
    expect(STAGES).not.toMatch(/actions\/cache@|rust-cache|build-llama/)
  })

  it('the provenance record is attached to the release next to the installers', () => {
    const attach = steps(job(STAGES, 'publish')).find((s) => s.includes('- name: Attach the signed Windows installers and update latest.json'))
    expect(attach).toContain('gh release upload "$TAG" "$RUNNER_TEMP/signpath/chain/installers/llama-cpp-provenance.json"')
  })
})
