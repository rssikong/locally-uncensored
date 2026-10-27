/**
 * Acceptance android-4gb, F14: after the third end of the renderer in a row
 * the app closed without a word, and the next start said nothing.
 *
 * The guard is native on both systems, because a page without its renderer
 * cannot say anything. Its rule is tested where it lives (RenderGuardTest.kt
 * over Gradle, ContentGuardRule over scripts/mobile/native-guard-tests.sh).
 * This file holds what those two cannot see: that the part with a screen
 * acts on the rule, in the right order, and that both systems say that the
 * chats are saved.
 *
 * Run: npx vitest run src/mobile/resilience/__tests__/guard-end-is-said.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PLUGIN = resolve(__dirname, '../../../../src-tauri/plugins/lu-native')
const read = (path: string) => readFileSync(resolve(PLUGIN, path), 'utf8')

describe('Android: the end of the restart loop', () => {
  const guard = read('android/src/main/java/com/purpledoubled/lunative/RenderGuard.kt')

  it('is noted on the disk before the process is ended', () => {
    const gone = guard.slice(guard.indexOf('private fun gone('), guard.indexOf('fun sayIfEnded('))
    const noted = gone.indexOf('RenderGone.noteEnded(')
    const killed = gone.indexOf('Process.killProcess(')
    expect(noted).toBeGreaterThan(-1)
    expect(killed).toBeGreaterThan(noted)
    expect(gone).toContain('if (RenderGone.owesWord(step))')
    // commit, not apply: apply would be lost with the process.
    const note = guard.slice(guard.indexOf('fun noteEnded('), guard.indexOf('fun takeEnded('))
    expect(note).toContain('.commit()')
    expect(note).not.toContain('.apply()')
  })

  it('is said at the next start, once, in a dialog that does not need the page', () => {
    const say = guard.slice(guard.indexOf('fun sayIfEnded('), guard.indexOf('fun returned('))
    expect(say).toContain('RenderGone.takeEnded(activity)')
    expect(say).toContain('AlertDialog.Builder(activity)')
    const take = guard.slice(guard.indexOf('fun takeEnded('))
    expect(take).toContain('remove(ENDED_KEY)')
    const plugin = read('android/src/main/java/com/purpledoubled/lunative/LuNativePlugin.kt')
    expect(plugin).toContain('renderGuard.sayIfEnded()')
  })

  it('says why, and that the chats are saved', () => {
    expect(guard).toContain('const val ENDED_TEXT = "LU closed because the page kept failing. Your chats are saved."')
  })
})

describe('iOS: the page is not loaded again', () => {
  const guard = read('ios/Sources/ContentGuard.swift')
  const rule = read('ios/Sources/ContentGuardRule.swift')

  // Acceptance iPhone, second part, P2: after the fourth end of the content process inside a minute the screen
  // stayed bright and empty, without a word and without a button.
  it('is said at once on a surface of the app with a sentence and a button, once per stretch of failures', () => {
    const reload = guard.slice(guard.indexOf('private func reload('), guard.indexOf('private func sayGaveUp('))
    expect(reload).toContain('if ContentGuardRule.saysGaveUp(mayReload: may, shown: gaveUpView != nil) { sayGaveUp(over: webview) }')
    expect(guard).toContain('GaveUpView(text: ContentGuardRule.gaveUpText, button: ContentGuardRule.gaveUpButton)')
    // Not an alert: after its OK the empty screen would be back.
    expect(guard).not.toContain('UIAlertController')
    // A page that answers again takes the surface away.
    expect(guard).toContain('if ContentGuardRule.gaveUpEnds(userReloads: false, pageAnswers: true) { self.endGaveUp() }')
  })

  it('the button loads the page again, and that reload is not held against the count', () => {
    const say = guard.slice(guard.indexOf('private func sayGaveUp('), guard.indexOf('private func endGaveUp('))
    expect(say.indexOf('self.reloads = ContentGuardRule.afterUserReload(self.reloads)')).toBeGreaterThan(0)
    expect(say.indexOf('self.reloads = ContentGuardRule.afterUserReload(self.reloads)')).toBeLessThan(say.indexOf('self.reload(webview, why: "the user tapped Reload")'))
    expect(guard).toContain('button.addTarget(self, action: #selector(tapped), for: .touchUpInside)')
  })

  it('says that the chats are saved, and the button says what it does', () => {
    expect(rule).toContain('static let gaveUpText = "LU ran into a problem. Your chats are saved."')
    expect(rule).toContain('static let gaveUpButton = "Reload"')
  })
})

describe('both sentences', () => {
  it('are plain English without a long dash', () => {
    const texts = [
      /ENDED_TEXT = "([^"]+)"/.exec(read('android/src/main/java/com/purpledoubled/lunative/RenderGuard.kt'))?.[1] ?? '',
      /gaveUpText = "([^"]+)"/.exec(read('ios/Sources/ContentGuardRule.swift'))?.[1] ?? '',
    ]
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(20)
      expect(text).not.toMatch(/[–—]/)
      expect(text).toContain('Your chats are saved.')
    }
  })
})
