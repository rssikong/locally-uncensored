/**
 * Where the kit ends.
 *
 * src/mobile/ui is what every strand builds on. If a file in it imported a
 * screen or a notice of a strand, every strand would hang on that strand.
 * And what a strand had to work around until the kit could do it (a wrapper
 * for the risk mark, a frame around a row) must not come back as a second
 * way next to the prop.
 */
import { describe, expect, it } from 'vitest'
import { DRAWS_ENGINE_NOTICES, engineNoticesMounted } from '../boot/engine-notices'
import { MOBILE_DIR, importsOf, sourceFiles, stripComments } from './scan'

const files = sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])

describe('src/mobile/ui stands on its own', () => {
  const kit = files.filter((f) => f.rel.startsWith('mobile/ui/'))

  it('finds the kit', () => {
    expect(kit.length).toBeGreaterThan(30)
  })

  it('imports no screen, no notice of a strand and no strand texts', () => {
    const hits: string[] = []
    for (const file of kit) {
      for (const hit of importsOf(file)) {
        if (hit.target === null) continue
        const target = hit.target
        if (target.startsWith('mobile/screens/') || target.startsWith('mobile/resilience/')) hits.push(`${file.rel} imports ${hit.spec}`)
        if (target.startsWith('mobile/strings/') && !/^mobile\/strings\/common(\.ts)?$/.test(target)) hits.push(`${file.rel} imports ${hit.spec}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('the Markdown of an answer is not part of the first chunk of the kit', () => {
    const index = files.find((f) => f.rel === 'mobile/ui/index.ts')!
    const targets = importsOf(index).map((hit) => hit.target)
    expect(targets).not.toContain('mobile/ui/Markdown')
    expect(targets).not.toContain('mobile/ui/highlight-code')
    // The highlighter is loaded on demand, by the Markdown and by nothing else.
    const loaders = files.filter((f) => importsOf(f).some((hit) => hit.target === 'mobile/ui/highlight-code')).map((f) => f.rel)
    expect(loaders).toEqual(['mobile/ui/Markdown.tsx'])
    const markdown = files.find((f) => f.rel === 'mobile/ui/Markdown.tsx')!
    expect(importsOf(markdown).find((hit) => hit.target === 'mobile/ui/highlight-code')?.dynamic).toBe(true)
  })
})

describe('the frame draws no second copy of a notice', () => {
  const root = stripComments(files.find((f) => f.rel === 'mobile/MobileRoot.tsx')!.text)

  it('the unseen copy of EngineNotices steps aside when a mounted page draws them', () => {
    expect(engineNoticesMounted(['/chats', '/chat/:id'])).toBe(true)
    expect(engineNoticesMounted(['/chat/:id', '/chat/:id/file'])).toBe(true)
    expect(engineNoticesMounted(['/settings', '/settings/engine'])).toBe(true)
    // Deeper than the two mounted pages does not count: that page is not in the document.
    expect(engineNoticesMounted(['/chat/:id', '/settings', '/settings/about'])).toBe(false)
    expect(engineNoticesMounted(['/models', '/settings/engine/advanced'])).toBe(true)
    expect(engineNoticesMounted(['/models'])).toBe(false)
    expect(engineNoticesMounted([])).toBe(false)
  })

  it('the pages named there are the ones that mount EngineNotices', () => {
    const users = files.filter((f) => /<EngineNotices\b/.test(stripComments(f.text))).map((f) => f.rel).sort()
    expect(users).toEqual(['mobile/MobileRoot.tsx', 'mobile/screens/chat/ChatPage.tsx', 'mobile/screens/models/EngineAdvancedPage.tsx', 'mobile/screens/models/EnginePage.tsx'])
    expect(DRAWS_ENGINE_NOTICES).toEqual(['/chat/:id', '/settings/engine', '/settings/engine/advanced'])
    expect(root).toMatch(/if \(drawn\) return null/)
  })
})

describe('the risk mark has one way in the kit', () => {
  it('data-m-risk is written by riskProps and by no component of the kit on its own', () => {
    const writers = files
      .filter((f) => f.rel.startsWith('mobile/ui/'))
      .filter((f) => /data-m-risk/.test(stripComments(f.text)))
      .map((f) => f.rel)
    expect(writers).toEqual(['mobile/ui/common.ts'])
  })
})
