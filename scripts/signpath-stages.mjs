#!/usr/bin/env node
// signpath-stages.mjs: the bookkeeping of the staged SignPath lane.
//
// A production signing request waits for a person to approve it in SignPath.
// That may take minutes or days, so no job waits for it. The Windows release
// is cut into stages, each of which ends by handing a request to SignPath:
//
//   1. app         release.yml (the run on the tag) builds the app, uploads
//                  the unsigned binary and everything the installers need,
//                  and submits the binary. .github/actions/windows-signpath
//   2. installers  windows-signpath.yml fetches the signed binary, packs the
//                  NSIS and MSI installers around it and submits them.
//                  .github/actions/windows-signpath-installers
//   3. publish     windows-signpath.yml fetches the signed installers, writes
//                  the updater signatures, attaches everything to the release
//                  and merges latest.json. .github/actions/windows-signpath-finish
//
// Between the stages nothing runs. A watcher (windows-signpath.yml on a
// schedule) asks SignPath about the open requests and starts the next stage
// on the tag when one is completed. Every stage can also be started by hand.
//
// WHERE THE STATE LIVES. Every stage that finishes leaves a small workflow
// artifact named signpath-state-<label>-<n>-<step> (label: the tag, or
// probe-<run id> for the signing probe). It holds state.json: the request ID
// and its link, the run that made it, the commit, the version. Nothing secret:
// request IDs are useless without the SignPath token, and the artifact is as
// public as the run itself. Artifacts cannot be changed after the upload, so
// a stage that runs again adds a newer one; the newest unexpired one of each
// step counts, and a later step counts only when it names the request of the
// step before it (resubmitting the app binary therefore starts a new chain).
//
// IDEMPOTENT. Before a stage submits, `plan` reads the chain and asks
// SignPath. A stage whose request is waiting or completed does nothing; it
// submits again only when its last request ended without a signature
// (denied, failed, canceled). A publish that already happened is not redone.
//
// Commands (paths are relative to the working directory):
//   plan <app|build|installers|publish> <label> [state-dir]
//                         decide whether the stage runs; outputs run=true|false
//                         and the chain; copies the state files to state-dir
//   watch                 the watcher: every open chain, one step further
//   write-state <dir> <label> <step> [key=value ...]
//                         state.json for the artifact of a finished step
//   download-signed <request-id> <out-dir>
//                         the signed artifact of a completed request, unpacked
//   provenance <triple> <out-file>
//                         llama-cpp-provenance.json for the shipped llama.cpp files
//   check-provenance <file>
//                         the files on disk are the ones the record names
//
// The network is reached through fetch only, at GITHUB_API_URL and
// SIGNPATH_CONNECTOR_URL, so src/lib/__tests__/signpath-stages.test.ts runs
// all of it against a local stand-in for both services.
import { createHash } from 'node:crypto'
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, inflateRawSync } from 'node:zlib'

export const STEPS = ['app', 'installers', 'published']
export const RELEASE_TAG = /^refs\/tags\/(v[0-9]+\.[0-9]+\.[0-9]+)$/
export const DEFAULT_CONNECTOR = 'https://pipelineconnector.connectors.signpath.io/GitHubActions/GitHubCom'
/** The workflow that runs stages 2 and 3 of a release and the watcher. */
export const STAGES_WORKFLOW = 'windows-signpath.yml'

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(message)
}

// ── State ──────────────────────────────────────────────────────────────────

export function stateArtifactName(label, step) {
  const at = STEPS.indexOf(step)
  if (at < 0) fail(`unknown step "${step}", expected one of ${STEPS.join(', ')}`)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label ?? '')) fail(`"${label}" is no usable label`)
  return `signpath-state-${label}-${at + 1}-${step}`
}

/** The tag of a release tag ref, or null. */
export function releaseTagOf(ref) {
  return RELEASE_TAG.exec(ref ?? '')?.[1] ?? null
}

/**
 * The current chain out of the newest state of each step. A later step only
 * belongs to the chain when it names the request of the step before it.
 */
export function currentChain(states) {
  const app = states.app ?? null
  const installers = app && states.installers?.appRequestId === app.requestId ? states.installers : null
  const published = installers && states.published?.installersRequestId === installers.requestId ? states.published : null
  return { app, installers, published }
}

/** completed, waiting or ended (final, but no signature came of it). */
export function classify(status) {
  if (!status) return 'ended'
  if (status.isFinalStatus) return status.status === 'Completed' ? 'completed' : 'ended'
  return 'waiting'
}

const STAGE_OF_STEP = { app: 'app', installers: 'installers' }

/** The command that submits a step again, for the run page. */
export function resubmitCommand(stage, label, workflow = STAGES_WORKFLOW) {
  if (label.startsWith('probe-')) return `gh workflow run signpath-probe.yml --ref <branch> -f stage=${stage === 'app' ? 'build' : stage} -f label=${label}`
  return `gh workflow run ${workflow} --ref ${label} -f stage=${stage}`
}

/**
 * Whether a stage runs now. `statusOf(requestId)` answers with the SignPath
 * status of a request. Returns { run, level, message }: level "error" means
 * the stage must fail, "notice" that it has nothing to do.
 *
 *   build       stage 1 itself, inside the run on the tag (or the probe)
 *   app         stage 1 again from the build of that run, after the request
 *               of the app binary ended without a signature
 *   installers  stage 2
 *   publish     stage 3
 */
export async function planStage(stage, label, chain, statusOf) {
  const link = (state) => `[${state.requestId}](${state.requestUrl})`
  const describe = async (state) => {
    const status = await statusOf(state.requestId)
    return { status, kind: classify(status), name: status?.status ?? 'not found' }
  }
  const skip = (message) => ({ run: false, level: 'notice', message })
  const stop = (message) => ({ run: false, level: 'error', message })
  const go = (message) => ({ run: true, level: 'notice', message })

  if (stage === 'build' || stage === 'app') {
    if (!chain.app) {
      return stage === 'build'
        ? go(`no signing request for the app binary of ${label} yet, submitting one`)
        : stop(`there is no stage 1 for ${label} to submit again: its state artifact is missing or expired. Run the Windows job of the release run again.`)
    }
    const app = await describe(chain.app)
    if (app.kind === 'ended') return go(`the request of the app binary ${link(chain.app)} ended as "${app.name}", submitting the app binary again`)
    return skip(`the app binary of ${label} is submitted already: ${link(chain.app)} is "${app.name}". Nothing to do.`)
  }

  if (stage === 'installers') {
    if (!chain.app) return stop(`there is no stage 1 for ${label}: its state artifact is missing or expired`)
    const app = await describe(chain.app)
    if (app.kind === 'waiting') return skip(`the app binary of ${label} waits for approval in SignPath: ${link(chain.app)} is "${app.name}"`)
    if (app.kind === 'ended') {
      return stop(`the request of the app binary ${link(chain.app)} ended as "${app.name}". Submit it again: ${resubmitCommand('app', label)}`)
    }
    if (!chain.installers) return go(`the app binary of ${label} is signed (${link(chain.app)}), packing and submitting the installers`)
    const installers = await describe(chain.installers)
    if (installers.kind === 'ended') return go(`the request of the installers ${link(chain.installers)} ended as "${installers.name}", submitting the installers again`)
    return skip(`the installers of ${label} are submitted already: ${link(chain.installers)} is "${installers.name}". Nothing to do.`)
  }

  if (stage === 'publish') {
    if (!chain.installers) return stop(`the installers of ${label} were not submitted yet; stage 2 comes first`)
    if (chain.published) return skip(`${label} is published already from ${link(chain.installers)}. Nothing is overwritten.`)
    const installers = await describe(chain.installers)
    if (installers.kind === 'waiting') return skip(`the installers of ${label} wait for approval in SignPath: ${link(chain.installers)} is "${installers.name}"`)
    if (installers.kind === 'ended') {
      return stop(`the request of the installers ${link(chain.installers)} ended as "${installers.name}". Submit them again: ${resubmitCommand('installers', label)}`)
    }
    return go(`the installers of ${label} are signed (${link(chain.installers)}), publishing them`)
  }

  fail(`unknown stage "${stage}", expected build, app, installers or publish`)
}

/**
 * What the watcher does with one chain. `running` is the set of stage names
 * that have a run queued or in progress for this label.
 * Returns { action: none|done|wait|running|dispatch|ended, stage?, message }.
 */
export async function nextAction(label, chain, statusOf, running = new Set()) {
  if (!chain.app) return { action: 'none', message: `${label}: no SignPath chain` }
  if (chain.published) return { action: 'done', message: `${label}: published` }
  const [step, stage] = chain.installers ? ['installers', 'publish'] : ['app', 'installers']
  const state = chain[step]
  const status = await statusOf(state.requestId)
  const kind = classify(status)
  const name = status?.status ?? 'not found'
  const what = step === 'app' ? 'app binary' : 'installers'
  if (kind === 'waiting') {
    return { action: 'wait', step, state, status: name, message: `${label}: the ${what} ${step === 'app' ? 'waits' : 'wait'} for approval, [${state.requestId}](${state.requestUrl}) is "${name}"` }
  }
  if (kind === 'ended') {
    return {
      action: 'ended', step, state, status: name,
      message: `${label}: the request of the ${what} [${state.requestId}](${state.requestUrl}) ended as "${name}". Nothing continues by itself. To submit again: \`${resubmitCommand(STAGE_OF_STEP[step], label)}\``,
    }
  }
  if (running.has(stage)) return { action: 'running', stage, message: `${label}: ${stage} is running already` }
  return { action: 'dispatch', stage, message: `${label}: the ${what} ${step === 'app' ? 'is' : 'are'} signed, starting ${stage}` }
}

// ── ZIP, read ──────────────────────────────────────────────────────────────

/**
 * The files of a ZIP archive: [{ name, data }]. Stored and deflated entries,
 * ZIP64 included, which is what GitHub and SignPath hand out. Names that
 * would leave the target directory are refused.
 */
export function readZip(zip) {
  let end = -1
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === 0x06054b50) { end = at; break }
  }
  if (end < 0) fail('not a ZIP archive: no end of central directory')
  let count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = end - 20
    if (locator < 0 || zip.readUInt32LE(locator) !== 0x07064b50) fail('ZIP64 archive without its locator')
    const end64 = Number(zip.readBigUInt64LE(locator + 8))
    if (zip.readUInt32LE(end64) !== 0x06064b50) fail('ZIP64 archive without its end record')
    count = Number(zip.readBigUInt64LE(end64 + 32))
    offset = Number(zip.readBigUInt64LE(end64 + 48))
  }
  const files = []
  for (let i = 0, at = offset; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) fail('broken ZIP central directory')
    const method = zip.readUInt16LE(at + 10)
    const checksum = zip.readUInt32LE(at + 16)
    let compressed = zip.readUInt32LE(at + 20)
    let size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    let local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    // ZIP64 extra field: only the values that overflowed are in it, in order.
    for (let x = at + 46 + nameLength; x < at + 46 + nameLength + extraLength;) {
      const id = zip.readUInt16LE(x)
      const length = zip.readUInt16LE(x + 2)
      if (id === 0x0001) {
        let field = x + 4
        if (size === 0xffffffff) { size = Number(zip.readBigUInt64LE(field)); field += 8 }
        if (compressed === 0xffffffff) { compressed = Number(zip.readBigUInt64LE(field)); field += 8 }
        if (local === 0xffffffff) { local = Number(zip.readBigUInt64LE(field)) }
      }
      x += 4 + length
    }
    at += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    const clean = normalize(name.replace(/\\/g, '/'))
    if (isAbsolute(clean) || clean.split(/[\\/]/).includes('..')) fail(`the archive names a file outside its directory: ${name}`)
    if (zip.readUInt32LE(local) !== 0x04034b50) fail(`broken ZIP entry ${name}`)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(start, start + compressed)
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : fail(`${name}: compression method ${method} is not supported`)
    if (data.length !== size || crc32(data) !== checksum) fail(`${name}: the archive is damaged (size or checksum)`)
    files.push({ name: clean, data })
  }
  return files
}

export function extractZip(zip, outDir) {
  const out = resolve(outDir)
  const written = []
  for (const { name, data } of readZip(zip)) {
    const target = resolve(out, name)
    if (!target.startsWith(out + sep)) fail(`the archive names a file outside its directory: ${name}`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    written.push(name)
  }
  return written
}

// ── llama.cpp provenance ───────────────────────────────────────────────────

/** The pin of scripts/build-llama.sh: tag, commit and repository. */
export function llamaPin(script) {
  const value = (name) => new RegExp(`^${name}="\\$\\{${name}:-([^}]+)\\}"$`, 'm').exec(script)?.[1] ?? fail(`no ${name} default in scripts/build-llama.sh`)
  const pin = { tag: value('LLAMA_TAG'), commit: value('LLAMA_COMMIT'), repository: value('LLAMA_REPO').replace(/\.git$/, '') }
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) fail(`LLAMA_COMMIT is no full commit: ${pin.commit}`)
  return pin
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/**
 * Where each llama.cpp file of the build sits in the installed app. The
 * server comes from externalBin (bin/lu-llama-server-<triple>.exe, installed
 * without the triple), its libraries from resources/llama/<triple>/, which
 * tauri.windows.conf.json maps to the install directory itself.
 */
export function llamaFiles(root, triple) {
  const exe = triple.includes('-windows-') ? '.exe' : ''
  const server = `src-tauri/bin/lu-llama-server-${triple}${exe}`
  if (!existsSync(join(root, server))) fail(`${server} is missing: the llama.cpp server was not built`)
  const files = [{ installedAs: `lu-llama-server${exe}`, source: server }]
  const libraries = `src-tauri/resources/llama/${triple}`
  if (existsSync(join(root, libraries))) {
    for (const name of readdirSync(join(root, libraries)).sort()) {
      if (statSync(join(root, libraries, name)).isFile()) files.push({ installedAs: name, source: `${libraries}/${name}` })
    }
  }
  return files
}

export function provenanceOf(root, triple, env = {}) {
  const pin = llamaPin(readFileSync(join(root, 'scripts/build-llama.sh'), 'utf8'))
  for (const [name, wanted] of [['LLAMA_TAG', pin.tag], ['LLAMA_COMMIT', pin.commit]]) {
    if (env[name] && env[name] !== wanted) fail(`${name} is overridden in this build (${env[name]}), the record would name the wrong source`)
  }
  const run = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null
  return {
    component: 'llama.cpp',
    license: 'MIT',
    licenseText: `${pin.repository}/blob/${pin.commit}/LICENSE`,
    source: pin.repository,
    version: pin.tag,
    commit: pin.commit,
    sourceArchive: `${pin.repository}/archive/${pin.commit}.tar.gz`,
    builtBy: 'scripts/build-llama.sh, from source in the release run, no build cache',
    buildRun: run,
    commitOfThisRepository: env.GITHUB_SHA ?? null,
    target: triple,
    signed: false,
    note: 'These files are built from the upstream source named here and are not code signed: the SignPath Foundation certificate covers this project\'s own binaries only.',
    files: llamaFiles(root, triple).map((f) => {
      const data = readFileSync(join(root, f.source))
      return { ...f, size: data.length, sha256: sha256(data) }
    }),
  }
}

export function checkProvenance(root, record) {
  if (record.component !== 'llama.cpp' || !Array.isArray(record.files) || record.files.length === 0) fail('not a llama.cpp provenance record')
  const now = llamaFiles(root, record.target).map((f) => f.source).sort()
  const named = record.files.map((f) => f.source).sort()
  if (JSON.stringify(now) !== JSON.stringify(named)) fail(`the llama.cpp files differ from the record: on disk ${now.join(', ')}; recorded ${named.join(', ')}`)
  for (const f of record.files) {
    const got = sha256(readFileSync(join(root, f.source)))
    if (got !== f.sha256) fail(`${f.source} has sha256 ${got}, the record says ${f.sha256}`)
  }
  // tauri-build copies the server next to the app binary without the triple;
  // whichever copy the bundler takes, it is the recorded one.
  const server = record.files[0]
  const copy = join(root, 'src-tauri/target/release', server.installedAs)
  if (existsSync(copy) && sha256(readFileSync(copy)) !== server.sha256) {
    fail(`src-tauri/target/release/${server.installedAs} is not the recorded ${server.source}`)
  }
  return record.files.length
}

// ── The services ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** fetch with a few retries on 429 and 5xx, as the SignPath action does. */
async function request(url, options = {}, what = url) {
  for (let attempt = 1; ; attempt++) {
    let response
    try {
      response = await fetch(url, options)
    } catch (error) {
      if (attempt >= 4) fail(`${what}: ${error.message}`)
      await sleep(Number(process.env.SIGNPATH_STAGES_RETRY_MS ?? 2000) * attempt)
      continue
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await sleep(Number(process.env.SIGNPATH_STAGES_RETRY_MS ?? 2000) * attempt)
      continue
    }
    return response
  }
}

export function github(env = process.env) {
  const api = (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '')
  const repo = env.GITHUB_REPOSITORY ?? fail('GITHUB_REPOSITORY is not set')
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || fail('no GitHub token (GH_TOKEN) in the environment')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const call = async (path, options = {}) => {
    const response = await request(`${api}/repos/${repo}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } }, `GitHub ${path}`)
    if (!response.ok) fail(`GitHub ${options.method ?? 'GET'} ${path}: HTTP ${response.status} ${await response.text()}`)
    return response
  }
  return {
    repo,
    /** The newest unexpired artifact of that name, with the files in it. */
    async newestArtifact(name) {
      const list = await (await call(`/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`)).json()
      const live = (list.artifacts ?? []).filter((a) => a.name === name && !a.expired)
      live.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
      if (live.length === 0) return null
      const zip = Buffer.from(await (await call(`/actions/artifacts/${live[0].id}/zip`)).arrayBuffer())
      return { artifact: live[0], files: readZip(zip) }
    },
    async releaseTags(count = 10) {
      const releases = await (await call(`/releases?per_page=${count}`)).json()
      return releases.map((r) => r.tag_name).filter((t) => /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(t))
    },
    /** Display titles of the runs of a workflow that have not finished. */
    async unfinishedRuns(workflow) {
      const runs = await (await call(`/actions/workflows/${workflow}/runs?per_page=50`)).json()
      return (runs.workflow_runs ?? []).filter((r) => r.status !== 'completed').map((r) => r.display_title ?? r.name)
    },
    async dispatch(workflow, ref, inputs) {
      await call(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref, inputs }), headers: { 'Content-Type': 'application/json' } })
    },
  }
}

export function signpath(env = process.env) {
  const base = (env.SIGNPATH_CONNECTOR_URL || DEFAULT_CONNECTOR).replace(/\/$/, '')
  const organization = env.SIGNPATH_ORGANIZATION_ID || fail('SIGNPATH_ORGANIZATION_ID is not set')
  const token = env.SIGNPATH_API_TOKEN || fail('SIGNPATH_API_TOKEN is not set')
  const url = (id, what) => `${base}/${encodeURIComponent(organization)}/SigningRequests/${encodeURIComponent(id)}/${what}?api-version=1.0`
  const headers = { Authorization: `Bearer ${token}` }
  return {
    /** { status, isFinalStatus }, or null when SignPath does not know the request. */
    async status(id) {
      const response = await request(url(id, 'Status'), { headers }, 'SignPath status')
      if (response.status === 404) return null
      if (!response.ok) fail(`SignPath status of ${id}: HTTP ${response.status}`)
      const body = await response.json()
      return { status: String(body.status ?? ''), isFinalStatus: Boolean(body.isFinalStatus) }
    },
    async signedArtifact(id) {
      const response = await request(url(id, 'SignedArtifact'), { headers }, 'SignPath signed artifact')
      if (!response.ok) fail(`the signed artifact of ${id} could not be downloaded: HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    },
  }
}

/** The newest state of each step of a label, and the files that came with them. */
export async function loadStates(gh, label) {
  const states = {}
  const files = {}
  for (const step of STEPS) {
    const found = await gh.newestArtifact(stateArtifactName(label, step))
    if (!found) continue
    const state = found.files.find((f) => f.name === 'state.json') ?? fail(`${stateArtifactName(label, step)} has no state.json`)
    states[step] = JSON.parse(state.data.toString('utf8'))
    files[step] = found.files
  }
  return { states, files }
}

// ── Command line ───────────────────────────────────────────────────────────

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
  console.log(`${name}=${value}`)
}

function summary(lines) {
  const text = `${[].concat(lines).join('\n')}\n`
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  console.log(text.trimEnd())
}

function cached(statusOf) {
  const known = new Map()
  return async (id) => {
    if (!known.has(id)) known.set(id, await statusOf(id))
    return known.get(id)
  }
}

const commands = {
  async plan([stage, label, stateDir]) {
    if (!stage || !label) fail('usage: plan <build|app|installers|publish> <label> [state-dir]')
    const gh = github()
    const sp = signpath()
    const { states, files } = await loadStates(gh, label)
    const chain = currentChain(states)
    const verdict = await planStage(stage, label, chain, cached((id) => sp.status(id)))
    if (stateDir) {
      for (const step of STEPS) {
        if (!chain[step]) continue
        for (const file of files[step]) {
          const target = resolve(stateDir, step, file.name)
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, file.data)
        }
      }
    }
    output('run', String(verdict.run))
    output('version', chain.app?.version ?? '')
    output('app-request-id', chain.app?.requestId ?? '')
    output('app-request-url', chain.app?.requestUrl ?? '')
    output('app-attempt', String(chain.app?.attempt ?? 0))
    output('build-run-id', chain.app?.buildRunId ?? '')
    output('installers-request-id', chain.installers?.requestId ?? '')
    output('installers-request-url', chain.installers?.requestUrl ?? '')
    summary(`SignPath, ${stage} of ${label}: ${verdict.message}`)
    if (verdict.level === 'error') {
      console.error(`::error::${verdict.message}`)
      process.exitCode = 1
    }
  },

  async watch() {
    const gh = github()
    const env = process.env
    if (!env.SIGNPATH_API_TOKEN || !env.SIGNPATH_ORGANIZATION_ID) {
      summary('SignPath watcher: the SignPath values are not set in this repository, nothing to watch.')
      return
    }
    const sp = signpath()
    const statusOf = cached((id) => sp.status(id))
    const workflow = env.WATCH_WORKFLOW || STAGES_WORKFLOW
    const labels = env.WATCH_LABELS ? env.WATCH_LABELS.split(/[\s,]+/).filter(Boolean) : await gh.releaseTags()
    const unfinished = await gh.unfinishedRuns(workflow)
    const lines = ['## SignPath watcher', '']
    let open = 0
    for (const label of labels) {
      const { states } = await loadStates(gh, label)
      const chain = currentChain(states)
      const running = new Set(['installers', 'publish', 'app'].filter((stage) => unfinished.includes(`SignPath ${stage} ${label}`)))
      const next = await nextAction(label, chain, statusOf, running)
      if (next.action === 'none') continue
      if (next.action !== 'done') open++
      if (next.action === 'dispatch') {
        if (!releaseTagOf(`refs/tags/${label}`)) fail(`${label} is no release tag; the watcher starts stages on release tags only`)
        await gh.dispatch(workflow, `refs/tags/${label}`, { stage: next.stage })
      }
      if (next.action === 'ended') console.log(`::warning title=SignPath request ended::${next.message.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`)
      if (next.action === 'wait' && next.state.createdAt) {
        const days = (Date.now() - Date.parse(next.state.createdAt)) / 86400000
        if (days > 75) console.log(`::warning title=SignPath request waits long::${label} has waited ${Math.floor(days)} days. The build it needs is kept for 90 days; after that the release has to be built again.`)
      }
      lines.push(`- ${next.message}`)
    }
    if (open === 0) lines.push('No open SignPath request.')
    summary(lines)
  },

  'write-state'([dir, label, step, ...pairs]) {
    if (!dir || !label || !step) fail('usage: write-state <dir> <label> <step> [key=value ...]')
    stateArtifactName(label, step)
    const env = process.env
    const state = {
      schema: 1,
      label,
      step,
      ref: env.GITHUB_REF ?? null,
      commit: env.GITHUB_SHA ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      runUrl: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
      createdAt: new Date().toISOString(),
    }
    for (const pair of pairs) {
      const at = pair.indexOf('=')
      if (at < 1) fail(`"${pair}" is no key=value pair`)
      const key = pair.slice(0, at)
      const value = pair.slice(at + 1)
      state[key] = key === 'attempt' ? Number(value) : value
    }
    if (step !== 'published' && !state.requestId) fail(`the state of ${step} needs a requestId`)
    if (step === 'installers' && !state.appRequestId) fail('the state of installers needs the appRequestId it was packed from')
    if (step === 'published' && !state.installersRequestId) fail('the state of published needs the installersRequestId it was published from')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
    output('dir', resolve(dir))
    output('name', stateArtifactName(label, step))
  },

  async 'download-signed'([id, outDir]) {
    if (!id || !outDir) fail('usage: download-signed <request-id> <out-dir>')
    const sp = signpath()
    const status = await sp.status(id)
    if (classify(status) !== 'completed') fail(`signing request ${id} is "${status?.status ?? 'not found'}", not completed`)
    const written = extractZip(await sp.signedArtifact(id), outDir)
    if (written.length === 0) fail(`the signed artifact of ${id} is empty`)
    console.log(`signed artifact of ${id}: ${written.join(', ')}`)
    output('dir', resolve(outDir))
  },

  provenance([triple, outFile]) {
    if (!triple || !outFile) fail('usage: provenance <triple> <out-file>')
    const record = provenanceOf(process.cwd(), triple, process.env)
    mkdirSync(dirname(resolve(outFile)), { recursive: true })
    writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`)
    console.log(`llama.cpp ${record.version} (${record.commit}): ${record.files.length} files recorded in ${outFile}`)
    output('file', resolve(outFile))
  },

  'check-provenance'([file]) {
    if (!file) fail('usage: check-provenance <file>')
    const count = checkProvenance(process.cwd(), JSON.parse(readFileSync(file, 'utf8')))
    console.log(`the ${count} llama.cpp files are the ones ${basename(file)} names`)
  },
}

// Run as a program, not imported. Both sides resolved, because a temporary
// directory is often reached through a symbolic link.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [command, ...args] = process.argv.slice(2)
  const run = commands[command]
  if (!run) {
    console.error(`usage: signpath-stages.mjs <${Object.keys(commands).join('|')}> ...`)
    process.exit(2)
  }
  Promise.resolve()
    .then(() => run(args))
    .catch((error) => {
      console.error(`::error::${error.message}`)
      process.exit(1)
    })
}
