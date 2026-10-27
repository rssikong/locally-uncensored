/**
 * The phone shows no button for the image part of a model.
 *
 * The desktop offers "Add image input" on an installed model and "Include
 * image input" before a download, and removes a half-fetched part again
 * (`remove_image_part`). On a phone the command is not registered (lib.rs,
 * `#[cfg(desktop)]`), the engine inside the app loads no image part, and the
 * phone catalogue names none on purpose (data/mobile-models.ts). A button
 * would start something the phone cannot finish. Answer 3 of the desktop
 * session (09.10.2026): fine as long as no such button is visible there.
 *
 * The labels are written in exactly one place, lib/image-part.ts, and reach
 * the screen through three doors: the hook, the two label functions and the
 * desktop components that draw them. The mobile shell opens none of them.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOBILE_DIR, SRC_DIR, importsOf, sourceFiles } from './scan'

/** Modules that draw or start the image part offer. From src, without ending. */
const DOORS: readonly string[] = [
  'lib/image-part',
  'hooks/useImagePartOffer',
  'api/image-part-install',
  'components/models/AddImageInput',
  'components/models/ModelTiles',
  'components/models/DiscoverModels',
  'components/chat/ChatNotices',
  'components/onboarding/ModelsStep',
]
const WORDS = /\b(?:Add|Include) image input\b/

describe('no image part button on the phone', () => {
  const files = sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])
  const all = sourceFiles(SRC_DIR, ['.ts', '.tsx'])

  it('the two labels are written in lib/image-part.ts and nowhere else', () => {
    // As a string of the code (single quote or template), not as a quotation in a comment.
    const writers = all.filter((f) => /['`](?:Add|Include) image input/.test(f.text)).map((f) => f.rel)
    expect(writers).toEqual(['lib/image-part.ts'])
  })

  it('every file that uses the labels or the offer is one of the doors', () => {
    const users = all
      .filter((f) => /\b(?:addImageInputLabel|includeImageInputLabel|useImagePartOffer)\b/.test(f.text))
      .map((f) => f.rel.replace(/\.tsx?$/, ''))
    expect(users.length).toBeGreaterThan(3)
    for (const user of users) expect(DOORS, user).toContain(user)
  })

  it('the mobile shell imports none of the doors', () => {
    expect(files.length).toBeGreaterThan(100)
    const hits: string[] = []
    for (const file of files) {
      for (const hit of importsOf(file)) {
        if (hit.target === null) continue
        const target = hit.target.replace(/\.(tsx?|js)$/, '')
        if (DOORS.includes(target)) hits.push(`${file.rel} imports ${hit.spec}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('and writes neither label itself, in code or in its strings', () => {
    expect(files.filter((f) => WORDS.test(f.text)).map((f) => f.rel)).toEqual([])
  })

  it('the command that removes a part stays a desktop command', () => {
    const lib = readFileSync(path.resolve(SRC_DIR, '../src-tauri/src/lib.rs'), 'utf8')
    expect(lib).toMatch(/#\[cfg\(desktop\)\]\s+commands::download::remove_image_part,/)
    // Its one caller swallows the refusal a phone would give.
    const discover = readFileSync(path.resolve(SRC_DIR, 'api/discover.ts'), 'utf8')
    const at = discover.indexOf("backendCall('remove_image_part'")
    expect(at).toBeGreaterThan(0)
    expect(discover.slice(discover.lastIndexOf('try {', at), discover.indexOf('}\n}', at))).toMatch(/catch \(err\)/)
  })
})
