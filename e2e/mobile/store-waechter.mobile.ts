/**
 * The store guard: what a store build shows, page by page.
 *
 * In the presets `appstore` and `play` this spec draws EVERY route and EVERY
 * sheet of the tables (nav/routes.ts, nav/sheets.ts, read from the running
 * app, so a new page is in the run the day it is added), in three states of
 * the account: signed out, signed in with a plan, signed in without one.
 * What is on screen goes to the rules of e2e/mobile/store-rules.ts: no word
 * about buying, no pointer to the website, no advertising for answers
 * without limits, and no link outside the four legal ones.
 *
 * A page is not one picture. Where a page or a sheet has tabs (a segmented
 * control) or filter chips, the spec presses every tab and, under each tab,
 * every combination of the chips, and reads each state. So the onboarding is
 * read step by step and tab by tab, and the catalogue in every state of its
 * filters. The acceptance run on Android (8 GB, B3) found the mark and the
 * tab "Unfiltered" in a Play package behind exactly such a press, which this
 * spec did not make, and under a rule that let them pass where a model is
 * picked (store-rules.ts, now strict).
 *
 * LU Cloud is mocked at the network (e2e/support/cloud-mock.ts). Nothing is
 * signed in for real, nothing leaves the machine, no link is opened.
 *
 *   LU_E2E_PORT=5391 LU_E2E_ONLY=store-waechter npx playwright test --project=mobile
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { MOCK_CHAT_CATALOGUE, mockModelsAnswer } from '../support/chat-catalogue'
import { routeCloud } from '../support/cloud-mock'
import { declareAdult, screensLoaded, shellUrl } from './support'
import { IAP_ACCOUNT, IAP_HOST, IAP_PACKS, IPHONE_UA, iapState, playIapStore, routeIapAccount, routeIapServer, signInMocked } from './iap-support'
import { CONTACT_PLACE, FULL_NAME_SPELLINGS, IAP_PLACE, PLAY_SENTENCE, PLAY_SENTENCE_PLACES, PLAY_SENTENCE_PLACES_SIGNED_OUT, SUPPORT_EMAIL, isBuyingFinding, isPlaySentencePlace, linkAllowed, storeFindings, type GuardedPreset } from './store-rules'

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

type Account = 'signed-out' | 'plan' | 'no-plan'

interface Seen {
  /** "route /settings/about" or "sheet credits". */
  where: string
  text: string
  links: string[]
  /** What the contact row of About shows and names, piece by piece (CONTACT_PLACE). Empty on every other page. */
  contact: string[]
  /**
   * What the buttons that open the sheet "Add credits" show and name (IAP_PLACE.openers). Empty in every build
   * that has no such button, which is every preset: only the imagined build with purchase 'in-app' has them.
   */
  iap?: string[]
}

/** Where a model is picked: the words "Unfiltered" and "Abliterated" may stand there in a Play build, and only while its switch `unfilteredWords` is on. */
const PICKERS = /^(route \/models|route \/setup\/model|sheet model|sheet create-model|sheet create-preset|sheet remote-model)/

/** Props a sheet needs to show its real text. Every other sheet opens the way the table of the developer page opens it. */
const SHEET_PROPS: Record<string, unknown[]> = {
  credits: [{ reason: 'credits' }, { reason: 'video_budget' }, { reason: 'trainings' }],
  'chat-voice-gate': [{ kind: 'dictate' }, { kind: 'speak' }],
  'chat-link': [{ url: 'https://example.com/a-page' }],
  report: [{ kind: 'message', id: 'guard', model: 'Guard', source: 'cloud', excerpt: 'An answer.' }],
  model: [{ segment: 'cloud' }, { segment: 'local' }],
}

/** Real values for routes with a parameter, next to the sample the developer page uses. */
const ROUTE_PARAMS: Record<string, Array<Record<string, string>>> = {
  '/models/:id': [{ id: 'gemma-3-4b' }, { id: 'gemma-3-4b-abliterated' }, { id: 'qwen3-1.7b-abliterated' }, { id: 'dolphin3-llama3.2-1b' }],
  '/chat/:id': [{ id: 'new' }],
  '/settings/providers/:id': [{ id: 'custom' }, { id: 'openrouter' }],
  '/settings/personas/:id': [{ id: 'unrestricted' }, { id: 'new' }],
}

/**
 * A server that names models by words no store build may show (round 15).
 * Every list the phone reads from LU Cloud carries some: the chat catalogue
 * in the name, in the id, in a description and in a group, the catalogue of
 * Create in the label and in the id. What a store build makes of each is
 * said next to it; the run reads every page with these in the lists.
 */
export const WORDED_CHAT = [
  // The word in the name: a build with the mark "Direct" shows the name without it, a build without the mark does not list the model.
  { id: 'e2e-lab/Qwen3-8B-abliterated', name: 'Qwen3 8B Abliterated', shown: 'Qwen3 8B', direct: true },
  { id: 'e2e-lab/Castor-12B', name: 'Castor 12B (Uncensored)', shown: 'Castor 12B', direct: true },
  // A neutral name over an id that says it: listed by the name, the id is never on screen.
  { id: 'e2e-lab/Llama-3-Uncensored-8B', name: 'Atlas 8B', shown: 'Atlas 8B', direct: true },
  // No name at all: the last part of the id, read as words and without the word. Never the id.
  { id: 'e2e-lab/Mistral-NoFilter-7B', name: undefined, shown: 'Mistral 7B', direct: true },
  // The word only in what the server says about the model: nothing of that is shown.
  { id: 'e2e-lab/Borealis-9B', name: 'Borealis 9B', description: 'An uncensored model with no refusals. NSFW.', group: 'Unfiltered', owned_by: 'Abliterated Labs', shown: 'Borealis 9B', direct: true },
] as const

export const WORDED_CREATE = [
  { id: 'aurora-uncensored-xl', label: 'Aurora XL', kind: 'image', credits: { base: 300 }, shown: 'Aurora XL' },
  { id: 'vega-2', label: 'Vega 2 NSFW', kind: 'image', credits: { base: 300 }, description: 'Unfiltered image model.', group: 'Uncensored', shown: 'Vega 2' },
  { id: 'lyra-video-abliterated', label: 'Lyra Video (Unfiltered)', kind: 'video', t2v: true, i2v: true, clip: { short: 5 }, credits: { base: 40000 }, shown: 'Lyra Video' },
] as const

/** The words of those entries. None of them may be on any page of a store build. */
const WORDED = /abliterat|uncensor|unfilter|no ?filter|no refusals|nsfw/i

async function mockCloud(page: Page, account: Account): Promise<void> {
  await routeCloud(page, {
    license: account === 'no-plan' ? 'none' : 'active',
    access: true,
    paidPlan: account === 'plan',
    tierCatalog: true,
    extraCatalogModels: WORDED_CREATE.map(({ shown: _shown, ...entry }) => entry),
  })
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' }
  // The chat catalogue with its measured marks, so a model "with no refusals" is there to be shown or not.
  await page.route('https://lu-labs.ai/api/inference/v1/models', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const answer = mockModelsAnswer()
    const worded = WORDED_CHAT.map(({ shown: _shown, direct: _direct, ...entry }) => ({ object: 'model', owned_by: 'lu-labs', context_length: 131072, max_output_length: 8192, input_modalities: ['text'], think: 'never', ...entry }))
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ ...answer, data: [...answer.data, ...worded] }) })
  })
  await page.route('https://lu-labs.ai/api/account/content-policy', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ policy: 'off', ageConfirmedAt: null, ageConfirmationRequired: true }) })
  })
  await page.route('https://lu-labs.ai/api/funnel/switch', (route) => route.fulfill({ status: 204, headers: cors }))
  // Nothing else leaves the developer server. A search at a model hub, a font, a picture: all cut.
  await page.route(
    (url) => url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname) && url.hostname !== 'lu-labs.ai' && !url.pathname.includes('/auth/v1/'),
    (route) => route.abort('blockedbyclient'),
  )
}

async function open(page: Page, preset: GuardedPreset, account: Account): Promise<void> {
  await mockCloud(page, account)
  await declareAdult(page)
  await page.addInitScript(() => {
    const opened: string[] = []
    ;(window as unknown as { __opened: string[] }).__opened = opened
    window.open = (url?: string | URL) => {
      opened.push(String(url))
      return null
    }
  })
  await page.goto(shellUrl({ store: preset }))
  await page.getByTestId('m-app').waitFor()
  if (account !== 'signed-out') {
    await page.evaluate(async () => {
      const { supabaseCloud } = await import(/* @vite-ignore */ `${location.origin}/src/api/cloud/supabase.ts`)
      const { probeAccount } = await import(/* @vite-ignore */ `${location.origin}/src/hooks/useCloudAuth.ts`)
      await supabaseCloud().auth.signInWithPassword({ email: 'qa@lu-labs.ai', password: 'e2e-password' })
      await probeAccount()
      window.dispatchEvent(new CustomEvent('lu-models-refresh'))
    })
  }
  // Several runs share this machine. A server of another working copy on the same port would answer too, without the switches.
  const mine = await page.evaluate(async () => (await fetch(`${location.origin}/src/mobile/policy/gates.ts`)).ok)
  expect(mine, 'the developer server serves this working copy').toBe(true)
  const built = await page.evaluate(async () => {
    const { storePolicy } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/storePolicy.ts`)
    return storePolicy().preset as string
  })
  expect(built).toBe(preset)
}

interface Step {
  where: string
  kind: 'tab' | 'segment' | 'route' | 'flow' | 'sheet'
  id: string
  payload?: unknown
}

/** Runs in the page: go to one place of the app. */
async function goTo(step: Step): Promise<void> {
  const origin = location.origin
  const { navApi } = await import(/* @vite-ignore */ `${origin}/src/mobile/nav/api.ts`)
  const { useChatsSegment } = await import(/* @vite-ignore */ `${origin}/src/mobile/nav/chats-segment.ts`)
  if (navApi.getState().flow) navApi.finishFlow('chat')
  useChatsSegment.getState().setSegment('phone')
  navApi.resetTo('chat', [])
  if (step.kind === 'tab') navApi.switchTab(step.id)
  else if (step.kind === 'segment') useChatsSegment.getState().setSegment(step.id)
  else if (step.kind === 'route') navApi.push(step.id, step.payload)
  else if (step.kind === 'flow') {
    navApi.startFlow('onboarding')
    if (step.id !== '/welcome') navApi.push(step.id, step.payload)
  } else navApi.openSheet(step.id, step.payload)
}

/** Runs in the page: what is on screen right now, as a person reads it and as a screen reader does. */
function readScreen(contactTestid: string): { text: string; links: string[]; contact: string[]; iap: string[] } {
  const shown = (el: Element) => {
    if (el.closest('[data-m-hidden], [hidden], [inert]')) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }
  const parts: string[] = []
  const contact: string[] = []
  const iap: string[] = []
  const root = document.querySelector('[data-testid="m-app"]') ?? document.body
  const inContactRow = (el: Element) => !!el.closest(`[data-testid="${contactTestid}"]`)
  // The buttons that open the sheet "Add credits" (store-rules.ts IAP_PLACE.openers; this function runs in the page and cannot import the list).
  const OPENERS = '[data-testid="m-account-add-credits"], [data-testid="m-cloud-add-credits"], [data-testid="m-credits-add"]'
  // innerText skips what is not drawn; a page under another page or under a sheet is inert and left out.
  for (const box of Array.from(root.children)) if (shown(box)) parts.push((box as HTMLElement).innerText)
  for (const el of Array.from(root.querySelectorAll('[aria-label], [placeholder], [title], [alt]'))) {
    if (!shown(el)) continue
    for (const name of ['aria-label', 'placeholder', 'title', 'alt']) {
      const value = el.getAttribute(name)
      if (!value) continue
      parts.push(value)
      if (inContactRow(el)) contact.push(value)
      if (el.closest(OPENERS)) iap.push(value)
    }
  }
  // The contact row, as it reads on screen: the same text is part of the page text above.
  for (const row of Array.from(root.querySelectorAll(`[data-testid="${contactTestid}"]`))) if (shown(row)) contact.push((row as HTMLElement).innerText)
  const links = Array.from(root.querySelectorAll('a[href]'))
    .filter(shown)
    .map((a) => a.getAttribute('href') ?? '')
  for (const button of Array.from(root.querySelectorAll(OPENERS))) if (shown(button)) iap.push((button as HTMLElement).innerText)
  return { text: parts.join('\n'), links, contact, iap }
}

/** Runs in the page: the tabs and the filter chips of the screen on top, by their test ids. */
function controls(): { tabs: string[]; chips: string[] } {
  const shown = (el: Element) => {
    if (el.closest('[data-m-hidden], [hidden], [inert]')) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }
  const ids = (selector: string) => [
    ...new Set(
      Array.from(document.querySelectorAll(selector))
        .filter((el) => shown(el) && !(el as HTMLButtonElement).disabled)
        .map((el) => el.getAttribute('data-testid') ?? ''),
    ),
  ]
  return { tabs: ids('button[data-testid*="-segment-"]'), chips: ids('button[aria-pressed][data-testid*="-filter-"]') }
}

/** Runs in the page: press one control. A press that is not possible any more is not an error: the state before it was read. */
function press(testid: string): boolean {
  const el = Array.from(document.querySelectorAll(`[data-testid="${testid}"]`)).find((node) => !node.closest('[data-m-hidden], [hidden], [inert]')) as HTMLButtonElement | undefined
  if (!el || el.disabled) return false
  el.click()
  return true
}

/** Runs in the page: bring the filter chips to the wanted pressed states. Returns the states they really have afterwards. */
async function setChips(wanted: Record<string, boolean>): Promise<string> {
  const find = (testid: string) => Array.from(document.querySelectorAll(`[data-testid="${testid}"]`)).find((node) => !node.closest('[data-m-hidden], [hidden], [inert]')) as HTMLButtonElement | undefined
  for (const [testid, on] of Object.entries(wanted)) {
    const chip = find(testid)
    if (!chip || chip.disabled) continue
    if ((chip.getAttribute('aria-pressed') === 'true') !== on) {
      chip.click()
      await new Promise((done) => setTimeout(done, 60))
    }
  }
  return Object.keys(wanted)
    .filter((testid) => find(testid)?.getAttribute('aria-pressed') === 'true')
    .map((testid) => testid.replace(/^.*-filter-/, ''))
    .join('+')
}

/** The most chips a screen may have for every combination to be pressed (2^n states). */
const MAX_CHIPS = 5

/**
 * Every state of the screen on top: each tab, and under each tab every
 * combination of the filter chips. Appends what each state shows to `seen`
 * and returns how many states it read.
 */
async function everyState(page: Page, where: string, seen: Seen[]): Promise<number> {
  let states = 0
  const read = async (label: string) => {
    await screensLoaded(page)
    await page.waitForTimeout(200)
    seen.push({ where: `${where} [${label}]`, ...(await page.evaluate(readScreen, CONTACT_PLACE.testid)) })
    states += 1
  }
  const chipsOf = async (label: string) => {
    const { chips } = await page.evaluate(controls)
    if (chips.length === 0 || chips.length > MAX_CHIPS) return
    const done = new Set<string>()
    for (let mask = 0; mask < 1 << chips.length; mask++) {
      const wanted = Object.fromEntries(chips.map((chip, i) => [chip, (mask & (1 << i)) !== 0]))
      const real = await page.evaluate(setChips, wanted)
      // Chips that exclude each other end in a state that was read already.
      if (done.has(real)) continue
      done.add(real)
      await read(`${label}filters ${real || 'none'}`)
    }
  }
  const { tabs } = await page.evaluate(controls)
  if (tabs.length === 0) {
    await chipsOf('')
    return states
  }
  for (const tab of tabs) {
    if (!(await page.evaluate(press, tab))) continue
    const name = tab.replace(/^.*-segment-/, '')
    await read(`tab ${name}`)
    await chipsOf(`tab ${name}, `)
  }
  return states
}

/** Every route and every sheet of the tables of the running app, as steps to take. */
async function allSteps(page: Page): Promise<{ steps: Step[]; routes: string[]; sheets: string[] }> {
  const tables = await page.evaluate(async () => {
    const origin = location.origin
    const { navApi } = await import(/* @vite-ignore */ `${origin}/src/mobile/nav/api.ts`)
    const { ROUTE_IDS, routeDef, routeParamNames } = await import(/* @vite-ignore */ `${origin}/src/mobile/nav/routes.ts`)
    const { SHEET_IDS } = await import(/* @vite-ignore */ `${origin}/src/mobile/nav/sheets.ts`)
    const { TABS } = await import(/* @vite-ignore */ `${origin}/src/mobile/nav/types.ts`)
    return {
      tabs: (TABS as string[]).map((tab) => ({ tab, root: navApi.roots[tab] as string })),
      routes: (ROUTE_IDS as string[]).filter((r) => !routeDef(r)?.dev).map((r) => ({ id: r, kind: routeDef(r).kind as string, params: routeParamNames(r) as string[] })),
      sheets: (SHEET_IDS as string[]).filter((s) => !s.startsWith('dev-')),
    }
  })
  const steps: Step[] = []
  for (const { tab, root } of tables.tabs) steps.push({ where: `route ${root}`, kind: 'tab', id: tab })
  steps.push({ where: 'route /chats (segment remote)', kind: 'segment', id: 'remote' })
  for (const route of tables.routes) {
    if (route.kind === 'root') continue
    const sample = Object.fromEntries(route.params.map((name) => [name, `sample-${name}`]))
    const variants = route.params.length > 0 ? [sample, ...(ROUTE_PARAMS[route.id] ?? [])] : [undefined]
    for (const params of variants) {
      steps.push({ where: `route ${route.id}${params ? ` ${JSON.stringify(params)}` : ''}`, kind: route.kind === 'flow' ? 'flow' : 'route', id: route.id, payload: params })
    }
  }
  for (const sheet of tables.sheets) {
    for (const props of [undefined, ...(SHEET_PROPS[sheet] ?? [])]) steps.push({ where: `sheet ${sheet}${props ? ` ${JSON.stringify(props)}` : ''}`, kind: 'sheet', id: sheet, payload: props })
  }
  return { steps, routes: tables.routes.map((r) => r.id), sheets: tables.sheets }
}

/** Runs in the page: the app mode "Cloud" with the catalogue of Create loaded. Without it Create shows its gate and its lists are empty. */
async function cloudOn(): Promise<void> {
  const origin = location.origin
  const { useSettingsStore } = await import(/* @vite-ignore */ `${origin}/src/stores/settingsStore.ts`)
  const { refreshCatalog } = await import(/* @vite-ignore */ `${origin}/src/stores/cloudCatalogStore.ts`)
  useSettingsStore.getState().updateSettings({ appMode: 'cloud' })
  await refreshCatalog().catch(() => {})
  window.dispatchEvent(new CustomEvent('lu-models-refresh'))
}

/** Runs in the page: the tool of Create, which decides what the model sheet of Create lists. */
async function createTool(tool: string): Promise<void> {
  const { useCreateStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/createStore.ts`)
  useCreateStore.getState().setIntent(tool)
}

/** What is read a second time with LU Cloud on: Create and every sheet that lists Cloud models or says what something uses. */
const CLOUD_PLACES = /^(route \/create|sheet (create-|price|credits|model))/

/**
 * Draw every route and every sheet, one after the other, and read what is on
 * screen. With `cloud` the places of LU Cloud are drawn a second time in the
 * app mode "Cloud" (round 15): only there Create shows its tools, its prices
 * in credits and the models of its catalogue, once for images and once for
 * video.
 */
async function visitAll(page: Page, cloud = false): Promise<{ seen: Seen[]; routes: string[]; sheets: string[] }> {
  const { steps, routes, sheets } = await allSteps(page)
  const seen: Seen[] = []
  const visit = async (step: Step, where: string) => {
    await page.evaluate(goTo, step)
    // The file of the screen, then what the screen asks its services for.
    await screensLoaded(page)
    await page.waitForTimeout(350)
    seen.push({ where, ...(await page.evaluate(readScreen, CONTACT_PLACE.testid)) })
    await everyState(page, where, seen)
  }
  for (const step of steps) await visit(step, step.where)
  if (cloud) {
    await page.evaluate(cloudOn)
    await page.waitForTimeout(400)
    const again = steps.filter((step) => CLOUD_PLACES.test(step.where))
    for (const step of again) await visit(step, `${step.where} (cloud on)`)
    // The model sheet of Create lists what the tool of the moment can use, and a page drawn above may have changed the tool.
    for (const tool of ['image', 'video']) {
      await page.evaluate(createTool, tool)
      for (const step of again.filter((s) => s.where === 'route /create' || s.where === 'sheet create-model')) await visit(step, `${step.where} (cloud on, ${tool})`)
    }
  }
  return { seen, routes, sheets }
}

/** LU_STORE_GUARD_DUMP=<folder> writes what every page showed, to read a run by hand. */
function dump(name: string, seen: Seen[], findings: string[]): void {
  const dir = process.env.LU_STORE_GUARD_DUMP
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ findings, seen }, null, 2))
}

/** The address of the mocked account (e2e/support/cloud-mock.ts). It is the user's own address, not a pointer to the website. */
const MOCK_ACCOUNT = 'qa@lu-labs.ai'

/**
 * The text of a page without the support address at the ONE place it may
 * stand: inside the contact row of About (decided 10.10.2026). Each piece of
 * the row is taken out of the page text once. The address anywhere else, on
 * another page or a second time on About, stays in the text and is found.
 */
function withoutContactRow(entry: Seen): string {
  // The states of a page (everyState) are read as "<where> [<state>]": the row is the same row there.
  if (entry.where !== CONTACT_PLACE.where && !entry.where.startsWith(`${CONTACT_PLACE.where} [`)) return entry.text
  let text = entry.text
  for (const piece of entry.contact) {
    if (!piece.includes(SUPPORT_EMAIL)) continue
    const at = text.indexOf(piece)
    if (at >= 0) text = text.slice(0, at) + piece.split(SUPPORT_EMAIL).join(' ') + text.slice(at + piece.length)
  }
  return text
}

function judge(seen: Seen[], preset: GuardedPreset, designation = false): string[] {
  const findings: string[] = []
  for (const entry of seen) {
    const text = withoutContactRow(entry).split(MOCK_ACCOUNT).join('the account')
    for (const finding of storeFindings(text, preset, { picker: PICKERS.test(entry.where), designation, supportAddress: false, playSentence: isPlaySentencePlace(entry.where) })) findings.push(`${entry.where}: ${finding}`)
    for (const href of entry.links) if (!linkAllowed(href)) findings.push(`${entry.where}: link ${href}`)
  }
  return findings
}

/**
 * The judgement for the imagined build with `purchase: 'in-app'` (round 17):
 * the rules of the App Store build, with one exception. Words about buying
 * may stand in the sheet "Add credits" (IAP_PLACE.where) and on the buttons
 * that open it (their text is taken out of the page once per button, so the
 * same words anywhere else on that page are found). Nothing else is excused:
 * the website, a name, a raw id and every link stay findings in the sheet too.
 */
function judgeInApp(seen: Seen[]): string[] {
  const findings: string[] = []
  for (const entry of seen) {
    const inSheet = entry.where === IAP_PLACE.where || entry.where.startsWith(`${IAP_PLACE.where} `)
    let text = withoutContactRow(entry).split(MOCK_ACCOUNT).join('the account')
    if (!inSheet) {
      for (const piece of entry.iap ?? []) {
        const at = text.indexOf(piece)
        if (at >= 0 && piece.trim() !== '') text = text.slice(0, at) + ' ' + text.slice(at + piece.length)
      }
    }
    for (const finding of storeFindings(text, 'appstore', { picker: PICKERS.test(entry.where), designation: false, supportAddress: false })) {
      if (inSheet && isBuyingFinding(finding)) continue
      findings.push(`${entry.where}: ${finding}`)
    }
    for (const href of entry.links) if (!linkAllowed(href)) findings.push(`${entry.where}: link ${href}`)
  }
  return findings
}

test('the imagined build with in-app purchase: the exception is the sheet and its buttons, nothing more', () => {
  // No page needed: what the judgement makes of a text, by where it stands.
  const at = (where: string, text: string, iap: string[] = [], links: string[] = []): Seen => ({ where, text, links, contact: [], iap })
  const sheet = 'Add credits\nSmall pack\n£1.23\nRestore purchase\nYour purchase went through.'
  // In the sheet the words and the price text of the store are fine. Under the rules of the App Store build they are findings.
  expect(judgeInApp([at(IAP_PLACE.where, sheet)])).toEqual([])
  expect(judge([at(IAP_PLACE.where, sheet)], 'appstore').length).toBeGreaterThanOrEqual(3)
  // The button on a page: fine once, as the button. The same words a second time on that page are found.
  expect(judgeInApp([at('route /settings/account', 'Account\nAdd credits\nSign out', ['Add credits'])])).toEqual([])
  expect(judgeInApp([at('route /settings/account', 'Account\nAdd credits\nAdd credits to keep going.\nSign out', ['Add credits'])])).toHaveLength(1)
  // Without the button the words are a finding: no page speaks of buying by itself.
  expect(judgeInApp([at('route /settings/account', 'Account\nAdd credits\nSign out')])).toHaveLength(1)
  expect(judgeInApp([at('route /create', 'Buy a pack to keep going.')]).length).toBeGreaterThan(0)
  expect(judgeInApp([at('sheet credits {"reason":"credits"}', 'See plans and packs', ['Add credits'])]).length).toBeGreaterThan(0)
  // The sheet excuses buying words and nothing else: the website, a pointer to it and a link stay findings.
  expect(judgeInApp([at(IAP_PLACE.where, 'Add credits\nCheaper on lu-labs.ai.')])).toHaveLength(1)
  expect(judgeInApp([at(IAP_PLACE.where, 'Add credits\nMore on our website.')])).toHaveLength(1)
  expect(judgeInApp([at(IAP_PLACE.where, 'Add credits', [], ['https://lu-labs.ai/pricing'])])).toEqual([`${IAP_PLACE.where}: link https://lu-labs.ai/pricing`])
  expect(judgeInApp([at('route /settings/account', 'Account', [], ['https://lu-labs.ai/pricing'])])).toHaveLength(1)
  // A sheet whose name only starts the same way is not the sheet.
  expect(judgeInApp([at(`${IAP_PLACE.where}-more`, 'Add credits')])).toHaveLength(1)
})

test('the support address is allowed in the contact row of About, and nowhere else', () => {
  // No page needed: what the guard makes of a page that names the address, by where it stands.
  const row = `Contact support\n${SUPPORT_EMAIL}`
  const aboutPage = (text: string, contact: string[]): Seen => ({ where: CONTACT_PLACE.where, text, links: [], contact })
  for (const preset of ['appstore', 'play'] as const) {
    // As the page reads: the row inside the page text, and the row once more as its own piece.
    expect(judge([aboutPage(`About LU\nVersion 3.0.7\n${row}\nCopy address`, [row])], preset)).toEqual([])
    // The same with a name for screen readers on the row.
    expect(judge([aboutPage(`About LU\n${row}\nContact support ${SUPPORT_EMAIL}`, [`Contact support ${SUPPORT_EMAIL}`, row])], preset)).toEqual([])
    // A second mention on About, outside the row.
    expect(judge([aboutPage(`${row}\nQuestions? Write to ${SUPPORT_EMAIL}.`, [row])], preset)).toHaveLength(1)
    // The address on About without the row showing it.
    expect(judge([aboutPage(`Write to ${SUPPORT_EMAIL}.`, [])], preset)).toHaveLength(1)
    // The same row text on any other page or sheet.
    expect(judge([{ where: 'route /settings/privacy', text: row, links: [], contact: [row] }], preset)).toHaveLength(1)
    expect(judge([{ where: 'sheet settings-delete-account', text: `Write to ${SUPPORT_EMAIL}.`, links: [], contact: [] }], preset)).toHaveLength(1)
    // The row does not excuse the website or another address of the domain.
    expect(judge([aboutPage(`Contact support\n${SUPPORT_EMAIL} and lu-labs.ai/pricing`, [`Contact support\n${SUPPORT_EMAIL} and lu-labs.ai/pricing`])], preset).length).toBeGreaterThan(0)
    expect(judge([aboutPage('Contact support\nsales@lu-labs.ai', ['Contact support\nsales@lu-labs.ai'])], preset)).toHaveLength(1)
  }
})

test('the rule itself: the sentence of a Play build about plans is allowed at its places and a finding everywhere else', () => {
  const at = (where: string, text: string): Seen => ({ where, text, links: [], contact: [] })
  for (const place of PLAY_SENTENCE_PLACES) {
    expect(judge([at(place, `Nothing here yet. ${PLAY_SENTENCE}`)], 'play'), place).toEqual([])
    expect(judge([at(`${place} [tab cloud]`, PLAY_SENTENCE)], 'play'), `${place}, a state`).toEqual([])
    // An App Store build says it nowhere.
    expect(judge([at(place, PLAY_SENTENCE)], 'appstore').length, `${place}, appstore`).toBeGreaterThan(0)
    // Another mention of the website at the same place stays a finding.
    expect(judge([at(place, `${PLAY_SENTENCE} More on lu-labs.ai.`)], 'play'), `${place}, a second mention`).toHaveLength(1)
  }
  for (const elsewhere of ['route /chats', 'route /settings', 'route /cloudy', 'sheet credits-more', 'route /create/batch']) {
    expect(judge([at(elsewhere, PLAY_SENTENCE)], 'play').some((f) => f.includes('lu-labs.ai:')), elsewhere).toBe(true)
  }
  expect(PLAY_SENTENCE_PLACES_SIGNED_OUT.every((place) => PLAY_SENTENCE_PLACES.includes(place))).toBe(true)
})

for (const preset of ['appstore', 'play'] as const) {
  for (const account of ['signed-out', 'plan', 'no-plan'] as const) {
    test(`store preset ${preset}, ${account}: no page and no sheet shows what the store forbids`, async ({ page }) => {
      test.setTimeout(600_000)
      await open(page, preset, account)
      const { seen, routes, sheets } = await visitAll(page, account !== 'signed-out')

      // Every route and every sheet of the tables was drawn, and each of them showed something.
      for (const route of routes) expect(seen.some((s) => s.where.startsWith(`route ${route}`)), `route ${route} was visited`).toBe(true)
      for (const sheet of sheets) expect(seen.some((s) => s.where.startsWith(`sheet ${sheet}`)), `sheet ${sheet} was visited`).toBe(true)
      const empty = seen.filter((s) => s.text.trim().length < 3).map((s) => s.where)
      expect(empty, 'pages and sheets that showed nothing').toEqual([])

      // The states behind a press were read too: every step of the onboarding with its tabs, the catalogue with its filters.
      const states = (start: string) => seen.filter((s) => s.where.startsWith(start) && s.where.includes(' [')).length
      expect(seen.filter((s) => s.where.startsWith('route /setup/model')).length, 'the starter page of the onboarding was read').toBeGreaterThan(0)
      for (const step of ['/welcome', '/setup/model', '/setup/documents', '/setup/done']) expect(seen.some((s) => s.where.startsWith(`route ${step}`)), `onboarding step ${step}`).toBe(true)
      expect(states('route /models'), 'states of the catalogue: both tabs and the filters under each').toBeGreaterThanOrEqual(4)
      expect(states('sheet model'), 'states of the model sheet of the chat').toBeGreaterThanOrEqual(2)

      // The switch of the build itself decides whether the two words may stand where a model is picked.
      const designation = await page.evaluate(async () => {
        const { storePolicy } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/storePolicy.ts`)
        return storePolicy().unfilteredWords === true
      })
      const findings = judge(seen, preset, designation)
      dump(`${preset}-${account}`, seen, findings)
      expect(findings).toEqual([])

      // Decided 10.10.2026 (reversible). A Play build says the one sentence about plans, and only at its places:
      // the walk names every page the sentence stood on, and none of them is outside PLAY_SENTENCE_PLACES. An
      // App Store build says it nowhere.
      const base = (where: string) => where.replace(/ [[{(].*$/, '')
      const said = [...new Set(seen.filter((s) => s.text.includes(PLAY_SENTENCE)).map((s) => base(s.where)))].sort()
      if (preset === 'play') {
        expect(said.filter((where) => !PLAY_SENTENCE_PLACES.includes(where)), 'pages outside the allowed places that say the sentence about plans').toEqual([])
        // Without an account it is the three places a walk on a device reaches. Signed in, the account decides.
        if (account === 'signed-out') expect(said).toEqual([...PLAY_SENTENCE_PLACES_SIGNED_OUT].sort())
        else expect(said.length, `${account}: places that say the sentence`).toBeGreaterThan(0)
      } else expect(said).toEqual([])

      // Decided 10.10.2026. The contact row of About shows the support address, and that is the one place it is
      // allowed at: the row was read (so the rule above had something to allow), and the page has no finding.
      const about = seen.find((s) => s.where === CONTACT_PLACE.where)
      expect(about?.contact.some((piece) => piece.includes(SUPPORT_EMAIL)), 'the contact row of About shows the support address').toBe(true)
      expect(judge([about!], preset)).toEqual([])
      // The App Store build has no search keys of one's own: the page Web search names no "API key", not once.
      const webSearch = seen.find((s) => s.where === 'route /settings/search')
      expect(webSearch, 'the page Web search was drawn').toBeTruthy()
      const apiKeys = webSearch!.text.match(/api key/gi) ?? []
      if (preset === 'appstore') expect(apiKeys).toEqual([])
      else expect(apiKeys.length).toBeGreaterThan(0)
      // Both store builds offer the sign in through a third party (David, 10.10.2026), and the walk went past it.
      // The button of Apple is not in this walk: it runs without a system. The page as an iPhone draws it is judged below.
      const accountPage = seen.find((s) => s.where === 'route /settings/account')
      if (account === 'signed-out') {
        expect(accountPage?.text ?? '').toMatch(/Continue with Google/)
        expect(accountPage?.text ?? '').toMatch(/Continue with GitHub/)
        expect(accountPage?.text ?? '').toContain('Use the same sign-in you used before to reach your existing account.')
        expect(accountPage?.text ?? '').not.toMatch(/apple/i)
      }
      // Round 15. The server of this run names models by the words (WORDED_CHAT, WORDED_CREATE). None of the words is
      // on any page, in no state of the account, and no page shows the long name of the product.
      const worded = seen.filter((s) => WORDED.test(s.text)).map((s) => s.where)
      expect(worded, 'pages that show a word of the worded models').toEqual([])
      expect(seen.filter((s) => FULL_NAME_SPELLINGS.test(s.text)).map((s) => s.where), 'pages that spell out the long name').toEqual([])
      if (account === 'plan') {
        const marks = await page.evaluate(async () => {
          const { storePolicy } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/storePolicy.ts`)
          const { directMarkShown } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/unfiltered.ts`)
          return directMarkShown(storePolicy()) as boolean
        })
        // Decided 10.10.2026: the App Store build lists no such model. Since r56 (18.10.2026, Option c) the Play build
        // lists none either and shows no mark "Direct"; the branch below proves the models absent in both.
        expect(marks).toBe(false)
        const chatSheet = seen.filter((s) => s.where.startsWith('sheet model')).map((s) => s.text).join('\n')
        const createSheet = seen.filter((s) => s.where.startsWith('sheet create-model')).map((s) => s.text).join('\n')
        // An ordinary model is in both lists: the lists were there to be read. Create lists its models with LU Cloud on.
        expect(chatSheet).toContain('Llama 4 Scout')
        expect(createSheet).toContain('Flux Schnell')
        expect(seen.some((s) => s.where.startsWith('route /create (cloud on') && !/Turn on Cloud/.test(s.text)), 'Create was drawn with LU Cloud on').toBe(true)
        if (marks) {
          // Every worded model is listed under its name without the word, and the mark stands in the list.
          for (const model of WORDED_CHAT) expect(chatSheet, model.id).toContain(model.shown)
          for (const model of WORDED_CREATE) expect(createSheet, model.id).toContain(model.shown)
          expect(chatSheet).toMatch(/\bDirect\b/)
          expect(createSheet).toMatch(/\bDirect\b/)
        } else {
          // Without the catalogue no model is listed that its name, its id or its description names by the word.
          // What the app does not read (the description of the models route) cannot hide a model: "Borealis 9B" stays.
          for (const model of WORDED_CHAT) expect(chatSheet.includes(model.shown), model.id).toBe(model.name === model.shown && !WORDED.test(model.id))
          for (const model of WORDED_CREATE) expect(createSheet, model.id).not.toContain(model.shown)
          expect(`${chatSheet}\n${createSheet}`).not.toMatch(/\bDirect\b/)
        }
      }
      // No page opened a browser tab by being drawn.
      expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([])
      // The mock carries models marked "no refusals": the run would have seen them.
      expect(MOCK_CHAT_CATALOGUE.some((m) => m.unfiltered === 'full')).toBe(true)
    })
  }
}

// Round 17: the imagined build with `purchase: 'in-app'`. No preset is such a build (policy/__tests__/in-app.test.ts);
// this run looks at the one David would make if Apple asks for it: the App Store preset with the one switch on
// (?purchase=in-app on the developer server), on an iPhone, with the address that credits a purchase and two packs
// handed in, the store of the system played. Every route and every sheet is drawn, signed in with a plan, and judged
// by the rules of the App Store build with ONE exception: the sheet "Add credits" and the buttons that open it.
test.describe('the imagined build with in-app purchase', () => {
  test.use({ userAgent: IPHONE_UA })

  /** What the store would word for a pack. Made up for this run: it has to look like money, so the run shows that the rule for money is excused in the sheet and nowhere else. */
  const PLAYED_PRICE = '£1.23'

  test('appstore with purchase in-app, plan: buying words only in the sheet "Add credits" and on its buttons, no link outside', async ({ page }) => {
    test.setTimeout(900_000)
    await mockCloud(page, 'plan')
    await routeIapAccount(page)
    const server = await routeIapServer(page)
    // mockCloud cuts every other host; the route of the played account server was added after it and answers first.
    expect(IAP_HOST).not.toBe('lu-labs.ai')
    await declareAdult(page)
    await page.addInitScript(() => {
      const opened: string[] = []
      ;(window as unknown as { __opened: string[] }).__opened = opened
      window.open = (url?: string | URL) => {
        opened.push(String(url))
        return null
      }
    })
    await page.goto(`${shellUrl({ store: 'appstore' })}&purchase=in-app`)
    await page.getByTestId('m-app').waitFor()
    await playIapStore(page, {
      products: [
        { id: IAP_PACKS[0], displayName: 'Small pack', description: 'Credits for chat and images.', displayPrice: PLAYED_PRICE },
        { id: IAP_PACKS[1], displayName: 'Large pack', displayPrice: PLAYED_PRICE },
      ],
    })
    await signInMocked(page)
    const mine = await page.evaluate(async () => (await fetch(`${location.origin}/src/mobile/lib/iap.ts`)).ok)
    expect(mine, 'the developer server serves this working copy').toBe(true)
    expect(await iapState(page)).toEqual({ preset: 'appstore', purchase: 'in-app', offered: true, account: true })

    const { seen, routes, sheets } = await visitAll(page, true)
    for (const route of routes) expect(seen.some((s) => s.where.startsWith(`route ${route}`)), `route ${route} was visited`).toBe(true)
    for (const sheet of sheets) expect(seen.some((s) => s.where.startsWith(`sheet ${sheet}`)), `sheet ${sheet} was visited`).toBe(true)

    const empty = seen.filter((s) => s.text.trim().length < 3).map((s) => s.where)
    expect(empty, 'pages and sheets that showed nothing').toEqual([])

    const findings = judgeInApp(seen)
    dump('appstore-in-app-plan', seen, findings)
    expect(findings).toEqual([])

    // The sheet was drawn with its packs: the words and the price text of the store were there to be judged,
    // and the rules of the App Store build without the exception find them.
    const sheet = seen.filter((s) => s.where === IAP_PLACE.where || s.where.startsWith(`${IAP_PLACE.where} `))
    expect(sheet.length).toBeGreaterThan(0)
    const sheetText = sheet.map((s) => s.text).join('\n')
    for (const words of ['Add credits', 'Small pack', 'Large pack', PLAYED_PRICE, 'Restore purchase']) expect(sheetText, words).toContain(words)
    const strict = judge(sheet, 'appstore')
    expect(strict.some((f) => f.includes('money:')), 'the price text is a finding without the exception').toBe(true)
    expect(strict.some((f) => f.includes('purchase:')), '"Restore purchase" is a finding without the exception').toBe(true)
    expect(strict.some((f) => f.includes('credits as something to get')), '"Add credits" is a finding without the exception').toBe(true)

    // The three buttons were drawn, each on its own page, and each is a finding without the exception.
    const withButton = (where: string) => seen.filter((s) => s.where.startsWith(where) && (s.iap ?? []).some((piece) => piece.includes('Add credits')))
    for (const where of ['route /settings/account', 'route /cloud', 'sheet credits']) {
      expect(withButton(where).length, `${where} shows the button "Add credits"`).toBeGreaterThan(0)
      expect(judge(withButton(where), 'appstore').some((f) => f.includes('credits as something to get')), `${where}: found without the exception`).toBe(true)
    }
    // Nowhere else: a page without one of the three buttons never says the words, and the played price is on no page but the sheet.
    const elsewhere = seen.filter((s) => !sheet.includes(s))
    expect(elsewhere.filter((s) => (s.iap ?? []).length === 0 && /add credits|purchas|restore purchase/i.test(s.text)).map((s) => s.where), 'pages that speak of buying without the button').toEqual([])
    expect(elsewhere.filter((s) => s.text.includes(PLAYED_PRICE)).map((s) => s.where), 'pages that show a price').toEqual([])
    // The buttons of a build that links to plans are in none of it.
    expect(seen.filter((s) => /See plans|View plans|Manage plan|lu-labs\.ai\/pricing/i.test(s.text)).map((s) => s.where)).toEqual([])
    // No link outside the four legal ones on any page, and nothing opened a browser tab by being drawn.
    expect(seen.flatMap((s) => s.links).filter((href) => !linkAllowed(href))).toEqual([])
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([])
    // Drawing every page bought nothing and handed nothing in.
    expect(server.calls).toEqual([])
    const asked = await page.evaluate(() => (window as unknown as { __iap: { log: string[] } }).__iap.log)
    expect(asked.filter((entry) => entry.startsWith('purchase') || entry.startsWith('finish'))).toEqual([])
    expect(asked.some((entry) => entry.startsWith('products'))).toBe(true)
    expect(IAP_ACCOUNT).toMatch(/^[0-9a-f-]{36}$/)
  })
})

// Round 15: on an iPhone the page Account names three services, "Sign in with Apple", "Continue with Google" and
// "Continue with GitHub". The walk above runs without a system, so it never sees the first one. Here the page is
// drawn as an iPhone draws it and goes to the same rules. The three names are the names of the ways to sign in:
// no word about buying, no pointer to a website, no advertising, and no link. The rules need no exception for them.
test.describe('the page Account on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' })

  for (const preset of ['appstore', 'play'] as const) {
    test(`store preset ${preset}: the three ways to sign in are no finding`, async ({ page }) => {
      await declareAdult(page)
      await page.goto(`${shellUrl({ route: '/settings/account' })}&store=${preset}`)
      await page.getByTestId('m-app').waitFor()
      await screensLoaded(page)
      const account = page.locator('.m-page:not([data-m-hidden]):not([data-m-exit])').last()
      await expect(account.getByTestId('m-account-apple')).toBeVisible()
      const text = await account.innerText()
      for (const words of ['Sign in with Apple', 'Continue with Google', 'Continue with GitHub', 'Use the same sign-in you used before to reach your existing account.']) expect(text, words).toContain(words)
      expect(storeFindings(text, preset, { picker: false, supportAddress: false })).toEqual([])
      // Nothing on the page is a link: the two buttons of the browser open it only when tapped, the one of Apple never.
      expect(await account.locator('a[href]').count()).toBe(0)
      // And the names of the buttons a screen reader hears go to the same rules.
      const names = await account.locator('button, [role="button"]').evaluateAll((all) => all.map((el) => el.getAttribute('aria-label') ?? '').filter(Boolean).join('\n'))
      expect(storeFindings(names, preset, { picker: false, supportAddress: false })).toEqual([])
    })
  }
})

const DIRECT_SENTENCE = 'Direct models follow instructions closely and add fewer refusals of their own. Your content settings still apply.'

test('store preset play, plan: since r56 a model named by the word is not offered, is put down when an earlier build left it active, and no mark "Direct" shows', async ({ page }) => {
  test.setTimeout(180_000)
  await open(page, 'play', 'plan')
  await page.evaluate(cloudOn)
  // The models route of this run carries the worded model: the list arrived, so its absence below is a decision of the build.
  const listed = () =>
    page.evaluate(async () => {
      const { useModelStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/modelStore.ts`)
      return (useModelStore.getState().models as Array<{ name: string }>).find((m) => /Qwen3-8B-abliterated/.test(m.name))?.name ?? null
    })
  await expect.poll(listed, { timeout: 20_000 }).toBeTruthy()
  const worded = (await listed())!
  // Chosen as the chat model (a backup, an earlier build): the build puts it down.
  await page.evaluate(async (name) => {
    const { useModelStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/modelStore.ts`)
    useModelStore.getState().setActiveModel(name)
  }, worded)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useModelStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/modelStore.ts`)
        return useModelStore.getState().activeModel as string | null
      }),
    )
    .not.toBe(worded)
  await screensLoaded(page)
  await expect(page.getByTestId('m-chat-model-direct')).toHaveCount(0)
  const head = await page.evaluate(readScreen, CONTACT_PLACE.testid)
  // The sheet that says what an answer uses carries no line about the mark.
  await page.evaluate(goTo, { where: 'sheet price', kind: 'sheet', id: 'price' } satisfies Step)
  await screensLoaded(page)
  await expect(page.getByTestId('m-price-direct')).toHaveCount(0)
  const sheet = await page.evaluate(readScreen, CONTACT_PLACE.testid)
  const seen: Seen[] = [
    { where: 'chat head', ...head },
    { where: 'sheet price', ...sheet },
  ]
  expect(judge(seen, 'play')).toEqual([])
  for (const entry of seen) {
    expect(entry.text, entry.where).not.toMatch(WORDED)
    expect(entry.text, entry.where).not.toContain(DIRECT_SENTENCE)
    expect(entry.text, entry.where).not.toMatch(/e2e-lab|::/)
  }
})

test('store preset open: the guard finds what it is meant to find', async ({ page }) => {
  // The same run in the open build must come back with findings. Otherwise the rules above prove nothing.
  test.setTimeout(600_000)
  await mockCloud(page, 'signed-out')
  await page.goto(shellUrl({ store: 'open' }))
  await page.getByTestId('m-app').waitFor()
  const { seen } = await visitAll(page)
  const findings = judge(seen, 'appstore', false)
  const about = (word: string) => findings.filter((f) => f.includes(word)).length
  // What the acceptance run found in a Play package (B3) is found by the Play rules here, each behind its own press:
  // the tab of the onboarding, the filter of the catalogue, the mark and the claim on a card.
  const play = judge(seen, 'play', false)
  const at = (where: string, word: string) => play.filter((f) => f.startsWith(where) && f.includes(`${word}:`)).length
  expect(at('route /setup/model', 'unfiltered'), 'tab "Unfiltered" of the onboarding').toBeGreaterThan(0)
  expect(at('route /setup/model [tab unfiltered', 'no refusals'), 'claim on a starter card behind the tab').toBeGreaterThan(0)
  expect(at('route /models', 'unfiltered'), 'filter "Unfiltered" of the catalogue').toBeGreaterThan(0)
  expect(play.filter((f) => /^route \/models \[.*unfiltered/.test(f) && (f.includes('no filter:') || f.includes('no refusals:'))).length, 'mark on a card behind the filter').toBeGreaterThan(0)
  expect(play.filter((f) => f.startsWith('route /models') && f.includes('abliterated:')).length, 'a name with "Abliterated" in the catalogue').toBeGreaterThan(0)
  expect(about('lu-labs.ai')).toBeGreaterThan(0)
  expect(about('plan:')).toBeGreaterThan(0)
  expect(about('hugging face')).toBeGreaterThan(0)
  expect(about('no refusals') + about('uncensored')).toBeGreaterThan(0)
  expect(seen.find((s) => s.where === 'route /settings/providers')?.text).toContain('OpenRouter')
})

/**
 * Second check on Android, F10: the search of the catalogue asks a model hub,
 * and what comes back is named by strangers. A store build that does not
 * list models without refusals showed three of them under the spelling
 * "lorablated".
 *
 * The run above cannot see that: it draws every page, and a page shows no
 * search hit by being drawn. Here the hub answers with such a repository and
 * an ordinary one, the search is typed, and the screen is read.
 */
const HUB_ORDINARY = 'e2e-lab/Hermes-3-Llama-3.1-8B-GGUF'
const HUB_HITS = [
  { id: 'e2e-lab/Hermes-3-Llama-3.1-8B-lorablated-GGUF', downloads: 9000 },
  { id: HUB_ORDINARY, downloads: 1200 },
]

/** Type a search in the catalogue and read the screen. Null where this build has no search. */
async function searchTheHub(page: Page): Promise<Seen | null> {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
  // Registered after the rule that cuts everything else, so these two answer first.
  await page.route('https://huggingface.co/api/models?search=*', (route) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify(HUB_HITS) }))
  await page.route('https://huggingface.co/api/models/*/*/tree/main*', (route) => {
    const leaf = new URL(route.request().url()).pathname.split('/')[4].replace(/-GGUF$/, '')
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify([{ type: 'file', path: `${leaf}-Q4_K_M.gguf`, size: 700 * 1024 * 1024 }]) })
  })
  await page.evaluate(goTo, { where: 'route /models', kind: 'tab', id: 'models' } satisfies Step)
  await screensLoaded(page)
  const visible = (testid: string) => page.locator(`[data-testid="${testid}"]:visible`)
  if ((await visible('m-models-segment-new').getAttribute('aria-checked')) !== 'true') await visible('m-models-segment-new').tap()
  await expect(visible('m-models-catalog')).toBeVisible()
  if ((await visible('m-models-search').count()) === 0) return null
  await visible('m-models-search').fill('hermes')
  // The ordinary hit is offered in every build that has a search: once it stands, the list is drawn.
  await expect(visible('m-models-hits').getByText('Hermes-3-Llama-3.1-8B', { exact: true })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(350)
  return { where: 'route /models (search)', ...(await page.evaluate(readScreen, CONTACT_PLACE.testid)) }
}

for (const preset of ['appstore', 'play'] as const) {
  test(`store preset ${preset}: a search hit from the hub that is named as a model without refusals`, async ({ page }) => {
    await open(page, preset, 'signed-out')
    const policy = await page.evaluate(async () => {
      const { storePolicy } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/storePolicy.ts`)
      return storePolicy() as { customModelUrl: boolean; hubSearch: boolean; unfilteredCatalog: boolean; unfilteredMarketing: boolean; unfilteredWords?: boolean }
    })
    // Decided 10.10.2026: neither store build has the open search (switch hubSearch). Kept as a question to the
    // policy, so the day a preset gets the search back the rest of this test judges its hits again.
    expect(policy.hubSearch).toBe(false)
    const hubSearches: string[] = []
    page.on('request', (request) => {
      if (/huggingface\.co\/api\/models\?search=/.test(request.url())) hubSearches.push(request.url())
    })
    const seen = await searchTheHub(page)
    // A build without the open search has no field to type in.
    expect(seen === null).toBe(!(policy.customModelUrl && policy.hubSearch))
    if (!seen) {
      // And no other way to the hit: its page, by its address, says "not offered", names nothing and asks the hub nothing.
      for (const hit of HUB_HITS) {
        await page.evaluate(goTo, { where: `route /models/:id ${hit.id}`, kind: 'route', id: '/models/:id', payload: { id: `hf:${hit.id}` } } satisfies Step)
        await screensLoaded(page)
        await page.waitForTimeout(350)
        const shown = { where: `route /models/:id hf:${hit.id}`, ...(await page.evaluate(readScreen, CONTACT_PLACE.testid)) }
        expect(shown.text, hit.id).toContain('This model is not available in this version of LU.')
        expect(shown.text, hit.id).not.toMatch(/lorablated|Hermes/i)
        expect(judge([shown], preset), hit.id).toEqual([])
      }
      expect(hubSearches).toEqual([])
      return
    }
    // Does this build list such models. Without the catalogue never; with it, a build that does not advertise
    // lists them only where the words may stand as a designation (switch unfilteredWords, where a build has it).
    const lists = policy.unfilteredCatalog && (policy.unfilteredMarketing || policy.unfilteredWords !== false)
    expect(/lorablated/i.test(seen.text), 'the hit named "lorablated" is on screen').toBe(lists)
    expect(judge([seen], preset, policy.unfilteredWords === true)).toEqual([])
  })
}

test('store preset open: the guard sees the search hit and knows the spelling', async ({ page }) => {
  await mockCloud(page, 'signed-out')
  await page.goto(shellUrl({ store: 'open' }))
  await page.getByTestId('m-app').waitFor()
  const seen = await searchTheHub(page)
  expect(seen?.text).toMatch(/lorablated/i)
  expect(judge([seen!], 'appstore', false).filter((f) => f.includes('abliterated, other spellings'))).not.toEqual([])
})
