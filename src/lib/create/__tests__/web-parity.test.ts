/**
 * Create in chat on the desktop against Create in chat on the web.
 *
 * The web app owns the contract: the two tools, the check of an order, the
 * texts the model reads, the order card. The desktop mirrors those files
 * (scripts/create-chat-mirror.mjs) instead of writing them a second time. This
 * guard runs the same transform against the web checkout and fails as soon as
 * a mirrored file is not its web source any more, in either direction: a web
 * change that was not taken over, or an edit made here by hand.
 *
 * The few files the desktop writes itself are held to the web's wording: the
 * system prompt texts and reasons of the switch, the two tool definitions,
 * the names the server's gate reads.
 *
 * Without a web checkout that has Create in chat this is skipped instead of
 * being green for no reason. LU_WEB_REPO says where it is; the usual
 * neighbours are tried otherwise.
 *
 * Run: LU_WEB_REPO=/path/to/web npx vitest run src/lib/create/__tests__/web-parity.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { CLASSES, MIRRORED, PATCHES, mirror } from '../../../../scripts/create-chat-mirror.mjs'
import { MUSIC_SECONDS, lengthCredits, lengthPrice } from '../bridge/credits'
import { webCheckout, webModule } from '../../__tests__/web-checkout'
import { useCloudCatalogStore } from '../../../stores/cloudCatalogStore'
import type { CloudModel } from '../../render/cloud-models'
import { CREATE_TOOLS_TOKENS, CREATE_TOOLS_WINDOW_SHARE } from '../chat-switch'

// Only LU_WEB_REPO names the counterpart (src/lib/__tests__/web-checkout.ts):
// a guard that picks its own checkout proves nothing about the one that ships.
const WEB = webCheckout('create-chat-parity', ['apps/web/lib/create/order.ts'])

const web = (path: string) => readFileSync(resolve(WEB!, 'apps/web', path), 'utf8')
const desktop = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

/** The source text of `export const NAME = ...` up to the blank line after it. */
function constant(source: string, name: string): string {
  const at = source.indexOf(`export const ${name} =`)
  if (at < 0) throw new Error(`No export const ${name}`)
  const end = source.indexOf('\n\n', at)
  return source.slice(at, end < 0 ? undefined : end).trim()
}

describe.skipIf(!WEB)('the mirrored files are the web files', () => {
  const files = Object.entries(MIRRORED as Record<string, string>)

  it('mirrors the whole contract, the store and the card', () => {
    expect(files.map(([w]) => w)).toEqual(expect.arrayContaining([
      'lib/create/chat-tools.ts', 'lib/create/order.ts', 'lib/create/engine.ts', 'lib/create/handles.ts',
      'lib/create/chat-catalog.ts', 'lib/create/chat-control.ts', 'lib/create/chat-run.ts',
      'lib/create/chat-attachments.ts', 'lib/create/media-wish.ts', 'lib/create/chat-origin.ts',
      'stores/createOrderStore.ts', 'components/chat/create/CreateOrder.tsx', 'components/chat/create/CreateMedia.tsx',
    ]))
  })

  it.each(files)('%s', (webPath, desktopPath) => {
    expect(desktop(desktopPath)).toBe(mirror(webPath, web(webPath)))
  })

  it.each(files)('%s compiles to the same code with and without its comments', (webPath) => {
    // The mirror leaves the web file's comments behind. Nothing else may go
    // with them: both texts through the compiler, comments off, are one text.
    const compiled = (text: string) => ts.transpileModule(text, {
      fileName: webPath,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, removeComments: true },
    }).outputText
    const withComments = mirror(webPath, web(webPath), { comments: true })
    const without = mirror(webPath, web(webPath))
    expect(compiled(without)).toBe(compiled(withComments))
    expect(without.length).toBeLessThanOrEqual(withComments.length)
  })

  it('names every place where a mirrored file differs, with a reason', () => {
    for (const patches of Object.values(PATCHES as Record<string, { why: string; from: string; to: string }[]>)) {
      for (const patch of patches) {
        expect(patch.why.length).toBeGreaterThan(20)
        expect(patch.from).not.toBe(patch.to)
      }
    }
    // Four files, nineteen places. The sixth draws the big view of a chat image
    // over the app, without which its prompt stood behind the composer. The
    // thirteen of A13 (21.10.2026) keep a sent job that lost its answer (the
    // poll ran out, the network went away) from being booked as "could not
    // start": it is followed to its end with its own deadline and can be
    // stopped, and a stop right after the submit asks the server. They are
    // for the web to take over; until it has, a new web state that moved one
    // of these places fails the mirror loudly. A further one is a decision,
    // not a drive-by.
    expect(Object.keys(PATCHES).sort()).toEqual(['components/chat/create/CreateMedia.tsx', 'lib/create/engine.ts', 'lib/create/order.ts', 'stores/createOrderStore.ts'])
    expect(Object.values(PATCHES as Record<string, unknown[]>).flat()).toHaveLength(19)
  })

  it('translates the classes of the card into the desktop tokens, and nothing else', () => {
    // Only the two components of the card, never logic. Every source class is
    // one the desktop's own guards refuse (an arbitrary type size, a fourth
    // control height, a grey outside the surface ladder, a colour token the
    // desktop does not have), and no target is one of those.
    const refused = /^(text-\[[\d.]+rem\]|h-\d+( w-\d+)?|dark:bg-\[#[0-9a-f]{6}\]|(text|bg|border)-lu-(success|danger)(\/\d+)?)$/
    expect(Object.keys(CLASSES).sort()).toEqual(['components/chat/create/CreateMedia.tsx', 'components/chat/create/CreateOrder.tsx'])
    for (const pairs of Object.values(CLASSES as unknown as Record<string, [string, string][]>)) {
      for (const [from, to] of pairs) {
        expect(from, from).toMatch(refused)
        expect(to.split(' ').some((cls) => refused.test(cls)), to).toBe(false)
      }
    }
    // The translated card carries none of them any more.
    for (const file of ['CreateOrder.tsx', 'CreateMedia.tsx']) {
      const src = desktop(`src/components/chat/create/${file}`)
      expect(src).not.toMatch(/text-\[[\d.]+rem\]|#1b1b1b|lu-success|lu-danger/)
    }
  })
})

describe.skipIf(!WEB)('what the desktop writes itself says what the web says', () => {
  it('the texts of the switch and of the system prompt', () => {
    const theirs = web('lib/create/chat-switch.ts')
    const ours = desktop('src/lib/create/chat-switch.ts')
    for (const name of [
      'CREATE_ON_PARAGRAPH', 'CREATE_UNAVAILABLE_SENTENCE', 'CREATE_OFF_HINT', 'CREATE_OFF_BLOCKED_HINT',
      'CREATE_MODEL_REASON', 'CREATE_TOOLS_TOKENS',
    ]) {
      expect(constant(ours, name), name).toBe(constant(theirs, name))
    }
    // The reasons next to the greyed switch that are not constants.
    for (const sentence of [
      "'Pick a model first.'",
      "'This model cannot call tools. Pick another one to use Create.'",
      'has too small a context window${size} for Create. Pick a larger model to use it.',
    ]) {
      expect(theirs).toContain(sentence)
      expect(ours).toContain(sentence)
    }
  })

  it('the measure of the window', () => {
    expect(constant(web('lib/create/tool-budget.ts'), 'CREATE_TOOLS_WINDOW_SHARE')).toBe(`export const CREATE_TOOLS_WINDOW_SHARE = ${CREATE_TOOLS_WINDOW_SHARE}`)
    expect(constant(web('lib/create/chat-switch.ts'), 'CREATE_TOOLS_TOKENS')).toContain(CREATE_TOOLS_TOKENS.toLocaleString('en-US').replace(',', '_'))
  })

  it('the two tool definitions the model reads', () => {
    const block = (source: string) => {
      const at = source.indexOf('export const CREATE_TOOLS: MCPToolDefinition[] = [')
      return source.slice(at, source.indexOf('\n]\n', at))
    }
    const theirs = block(web('api/mcp/builtin-tools.ts'))
    expect(theirs.length).toBeGreaterThan(1500)
    expect(block(desktop('src/api/mcp/create-tools.ts'))).toBe(theirs)
  })

  it('the price of a length: the catalogue rule gives the number the server books', async () => {
    type WebRate = { basis: 'audio' | 'video' | 'chars' | 'extension'; usd: number; block: number; min: number; max: number; quote: number }
    const theirs = await webModule<{
      LENGTH_MODEL_USD: Record<string, WebRate>
      CREDIT_USD: number
      lengthCredits: (model: string, units?: number) => number
    }>(WEB!, 'apps/web/lib/billing/credits.ts')
    const metered = Object.entries(theirs.LENGTH_MODEL_USD).filter(([, rate]) => rate.basis !== 'extension')
    expect(metered.length).toBeGreaterThan(8)
    // The catalogue entries as /api/jobs/catalog writes them (route.ts there).
    useCloudCatalogStore.setState({
      models: metered.map(([id, rate]) => ({
        id, label: id, kind: rate.basis === 'chars' ? 'audio' : 'video', ops: [rate.basis === 'chars' ? 'tts' : 'lipsync'],
        credits: {
          base: theirs.lengthCredits(id),
          length: { basis: rate.basis, block: rate.block, per_block: Math.round(rate.usd / theirs.CREDIT_USD), min: rate.min, max: rate.max, quote: rate.quote },
        },
      }) as CloudModel),
    })
    for (const [id, rate] of metered) {
      expect(lengthPrice(id)?.basis, id).toBe(rate.basis)
      for (const units of [undefined, 0, 0.2, 1, rate.min, rate.min + 0.01, 4.999999, 7.3, rate.quote, 99, 100, 101, 1234.5, rate.max, rate.max + 50]) {
        expect(lengthCredits(id, units), `${id} at ${units}`).toBe(theirs.lengthCredits(id, units))
      }
    }
  })

  it('the limits of a music track', () => {
    expect(web('lib/billing/credits.ts')).toContain(
      `export const MUSIC_SECONDS = { min: ${MUSIC_SECONDS.min}, max: ${MUSIC_SECONDS.max}, fallback: ${MUSIC_SECONDS.fallback} }\n`,
    )
  })

  it('reads the release and the model rule from the fields the server sends', () => {
    // The server's side of the contract, by name.
    expect(web('app/api/me/route.ts')).toContain('features: { createChat: createChatReleased(user) }')
    expect(web('app/api/inference/v1/models/route.ts')).toContain('create_in_chat: catalogCreateInChat(m.id)')
    // And the desktop's readers of exactly those names.
    expect(desktop('src/lib/create/chat-release.ts')).toContain('features?.createChat')
    expect(desktop('src/api/providers/openai-provider.ts')).toContain('create_in_chat: asBoolean(m.create_in_chat)')
  })
})
