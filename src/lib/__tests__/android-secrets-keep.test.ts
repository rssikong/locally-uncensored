/**
 * Review M10: an Android Keystore that does not answer for a moment must not
 * delete the sign-in, the Remote token and every key.
 *
 * The behaviour itself is tested in Kotlin (SecretsTest.kt, run by Gradle).
 * This file holds the wiring from the side every run of vitest sees: the
 * read path removes an entry in exactly one place, and never makes a new key.
 *
 * Run: npx vitest run src/lib/__tests__/android-secrets-keep.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ANDROID = join(HERE, '../../../src-tauri/plugins/lu-native/android/src')
const secrets = readFileSync(join(ANDROID, 'main/java/com/purpledoubled/lunative/Secrets.kt'), 'utf8')
const engine = readFileSync(join(ANDROID, 'main/java/com/purpledoubled/lunative/DownloadEngine.kt'), 'utf8')
const kotlinTest = readFileSync(join(ANDROID, 'test/java/com/purpledoubled/lunative/SecretsTest.kt'), 'utf8')

function body(source: string, signature: string): string {
  const at = source.indexOf(signature)
  expect(at, signature).toBeGreaterThan(-1)
  const rest = source.slice(at)
  return rest.slice(0, rest.indexOf('\n  }\n'))
}

describe('Android secure storage keeps an entry it could not read', () => {
  it('removes an entry only through forget, and forget runs only for an entry that is gone for good', () => {
    const get = body(secrets, '  fun get(account: String): String? {')
    expect(get).toMatch(/readWithCare\(/)
    expect(get).toMatch(/forget = \{ prefs\.edit\(\)\.remove\(account\)\.commit\(\) \}/)
    // The read path of the file removes in this one place (delete() is the user's own).
    expect(secrets.match(/\.remove\(account\)/g)?.length).toBe(2)

    const care = body(secrets, '    internal fun readWithCare(')
    expect(care).toMatch(/if \(isGoneForGood\(e\)\) \{\s+forget\(\)\s+return null/)
    expect(care).toMatch(/throw SecretException\(/)
    expect(care.match(/forget\(\)/g)?.length).toBe(1)
  })

  it('counts only a wrong tag, an invalidated key and a foreign text as gone for good', () => {
    const names = /private val GONE_FOR_GOOD = setOf\(([\s\S]*?)\)/.exec(secrets)?.[1] ?? ''
    expect(names.match(/"[^"]+"/g)).toEqual([
      '"javax.crypto.AEADBadTagException"',
      '"android.security.keystore.KeyPermanentlyInvalidatedException"',
    ])
    expect(secrets).not.toMatch(/catch \(e: Exception\) \{\s+null\s+\}/)
  })

  it('never makes a new key while reading', () => {
    const open = body(secrets, '  private fun open(name: String, stored: String): String {')
    expect(open).toMatch(/existingKey\(\) \?: throw KeyNotThere\(\)/)
    expect(open).not.toMatch(/[^a-zA-Z]key\(\)/)
  })

  it('tells the user that nothing was deleted', () => {
    const sentence = /const val NOT_ANSWERING =\s+"([^"]+)"/.exec(secrets)?.[1] ?? ''
    expect(sentence).toContain('Nothing was deleted')
    expect(sentence).toContain('sign in again')
    expect(sentence).not.toMatch(/[–—]/)
  })

  it('a download list survives a Keystore that does not answer', () => {
    expect(engine).toMatch(/val plain = try \{\s+secrets\.decrypt\(HEADER_SECRET \+ r\.id[\s\S]{0,120}\} catch \(e: Secrets\.SecretException\)/)
  })

  it('has its Kotlin tests', () => {
    for (const name of ['aKeystoreThatDoesNotAnswerDeletesNothingAndSaysSo', 'anEntryWrittenByAnotherKeyIsRemovedAndReadsAsNothing', 'aSecondTryThatWorksGivesTheValue']) {
      expect(kotlinTest).toContain(`fun ${name}()`)
    }
  })
})
