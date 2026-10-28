#!/usr/bin/env node
/**
 * The fork's changes to files that upstream owns, stored as patches.
 *
 * `watch-upstream.yml` merges upstream every hour. When that merge conflicts,
 * it takes upstream's side and replays these patches on top. That is only safe
 * if the patches are small and complete, which is why there is a short, explicit
 * list below instead of "whatever differs".
 *
 *   node scripts/fork-patches.mjs --check        # is every patch present?
 *   node scripts/fork-patches.mjs --regenerate   # after editing one of these
 *                                               # files on purpose
 *
 * The base is `upstream/master`, so a patch describes exactly what this fork
 * adds on top of the current upstream file — not what changed in our history.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** Every file this fork changes that upstream also owns. Keep it short. */
const FILES = [
  // i18n bootstrap: one call before React mounts.
  'src/main.tsx',
  // `playwright.config.ts` used to be here: it started the e2e web server in
  // English so 1600+ selectors kept working, and retried the two geometry
  // specs. This fork no longer runs e2e (the inherited `ci.yml` is disabled and
  // the release gate never ran it), and upstream rewrites that file often —
  // 3.0.8 turned `webServer` into an array for the mobile project, which is
  // exactly the kind of change that made the patch fail. Dropped on purpose:
  // one fewer file that can block a sync.
  // The updater checks THIS repository, not upstream's. It has to live in
  // tauri.conf.json (not an overlay): `release-dry-run.mjs` refuses a checked-in
  // overlay that sets plugins.updater, and a dry run rewrites this file.
  'src-tauri/tauri.conf.json',
  // The repository the update check asks, and the label that says so.
  'src/stores/updateStore.ts',
  // The "view release" link points at this repository.
  'src/components/layout/UpdateBadge.tsx',
  // Two guards walk every string in src/. The generated dictionary has to be
  // exempt, or it is read as UI copy.
  'src/lib/__tests__/keine-deutschen-saetze-in-der-oberflaeche.test.ts',
  'src/lib/__tests__/no-built-in-engine-left-on-screen.test.ts',
  // Layout, not copy: the three mode tabs are `flex-1` and `white-space` lets
  // CSS break Chinese between any two characters. At the minimum sidebar width
  // (200px) each tab keeps ~20.7px for a 22px label, so 聊天 stacks vertically
  // while Chat/Code only overflow — Latin words do not break mid-word. Fixing
  // this needs `whitespace-nowrap` on the buttons and `shrink-0` on the icons;
  // there is no selector that reaches these three without touching the file.
  'src/components/layout/Sidebar.tsx',
]

const DIR = '.fork/patches'
const BASE = process.env.FORK_PATCH_BASE ?? 'upstream/master'
const mode = process.argv.includes('--regenerate') ? 'regenerate' : 'check'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function patchName(index, file) {
  return `${String(index + 1).padStart(2, '0')}-${basename(file).replace(/\.tsx?$/, '')}.patch`
}

function regenerate() {
  mkdirSync(DIR, { recursive: true })
  let written = 0
  for (const [index, file] of FILES.entries()) {
    const diff = git('diff', '--no-color', BASE, '--', file)
    if (!diff.trim()) {
      console.log(`  空补丁（与 ${BASE} 一致）：${file}`)
      continue
    }
    const target = join(DIR, patchName(index, file))
    writeFileSync(target, diff, 'utf8')
    written += 1
    console.log(`  写入 ${target}  (${diff.split('\n').length - 1} 行)`)
  }
  console.log(`\n共 ${written} 个补丁，基线 ${BASE}`)
}

function check() {
  if (!existsSync(DIR)) {
    console.error(`缺少 ${DIR}，先跑 --regenerate`)
    process.exit(1)
  }
  const onDisk = new Set(readdirSync(DIR).filter((name) => name.endsWith('.patch')))
  let problems = 0
  for (const [index, file] of FILES.entries()) {
    const name = patchName(index, file)
    if (!onDisk.has(name)) {
      console.error(`  缺少补丁：${name}（对应 ${file}）`)
      problems += 1
      continue
    }
    const patch = join(DIR, name)
    // Applied here? `--reverse --check` succeeding means the tree already has it.
    if (tryGit('apply', '--reverse', '--check', patch)) {
      console.log(`  ✓ ${name}（已应用）`)
      continue
    }
    if (tryGit('apply', '--check', patch)) {
      console.log(`  ! ${name}（可应用，但当前树里没有）`)
      continue
    }
    console.error(`  ✗ ${name}（既不能应用、也不是已应用——上游改到了这一段）`)
    problems += 1
  }
  const expected = new Set(FILES.map((file, index) => patchName(index, file)))
  for (const extra of onDisk) {
    if (!expected.has(extra)) console.log(`  ? 多余补丁：${extra}`)
  }
  if (problems > 0) {
    console.error(`\n${problems} 个问题。上游改动后：先修文件，再 --regenerate。`)
    process.exit(1)
  }
  console.log('\n补丁齐全。')
}

function tryGit(...args) {
  try {
    git(...args)
    return true
  } catch {
    return false
  }
}

if (mode === 'regenerate') regenerate()
else check()
