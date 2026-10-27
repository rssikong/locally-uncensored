/**
 * The Hugging Face key must not travel to the host a download redirects to.
 *
 * On iOS the transfer belongs to a background URLSession. It follows
 * redirects by itself and does not ask the delegate, so the app cannot take
 * a header off between two hosts. What the system does by itself was
 * measured (scripts/mobile/ios-redirect-header-probe.sh): Authorization is
 * dropped at every redirect, every other header travels on. So the request
 * handed to the system carries Authorization and no other caller header.
 *
 * The rule itself runs in Swift (scripts/mobile/native-guard-tests.sh). This
 * file holds the wiring from the side every run of vitest sees.
 *
 * Run: npx vitest run src/lib/__tests__/ios-download-headers.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const downloads = read('src-tauri/plugins/lu-native/ios/Sources/Downloads.swift')
const guard = read('src-tauri/plugins/lu-native/ios/Sources/NetGuard.swift')

describe('headers of a download the system makes (iOS)', () => {
  it('the one place that builds the request sets only the filtered headers', () => {
    const at = downloads.indexOf('private func request(_ url: URL, _ headers: [String: String], id: String) -> URLRequest {')
    expect(at).toBeGreaterThan(-1)
    const body = downloads.slice(at, downloads.indexOf('\n  }\n', at))
    expect(body).toContain('for (name, value) in NetGuard.headersForSystemTransfer(headers) {')
    expect(body).not.toMatch(/for \(name, value\) in headers \{/)
    // No other place puts a header on a request.
    expect(downloads.match(/forHTTPHeaderField/g)?.length).toBe(1)
    expect(downloads).not.toMatch(/allHTTPHeaderFields\s*=|addValue\(/)
  })

  it('the filter keeps Authorization, whatever its case, and nothing else', () => {
    expect(guard).toContain('static let systemTransferHeader = "authorization"')
    expect(guard).toMatch(/static func headersForSystemTransfer\(_ headers: \[String: String\]\) -> \[String: String\] \{\s+headers\.filter \{ \$0\.key\.lowercased\(\) == systemTransferHeader \}/)
  })

  it('the delegate is not counted on for redirects, and the bytes are still checked where they come from', () => {
    expect(downloads).not.toContain('willPerformHTTPRedirection newRequest')
    expect(downloads).toContain('private func answeringAddressAllowed(')
  })

  it('today only Authorization is ever sent, and only to huggingface.co', () => {
    const rust = read('src-tauri/src/commands/download_mobile.rs')
    const at = rust.indexOf('pub(crate) fn hub_headers(')
    const body = rust.slice(at, rust.indexOf('\n}\n', at))
    expect(body.match(/headers\.insert\(/g)?.length).toBe(1)
    expect(body).toContain('headers.insert("Authorization".to_string()')
  })

  it('Android keeps the caller headers on the first host itself', () => {
    const kotlin = read('src-tauri/plugins/lu-native/android/src/main/java/com/purpledoubled/lunative/DownloadEngine.kt')
    expect(kotlin).toMatch(/if \(url\.host\.equals\(origin\.host, ignoreCase = true\) && url\.protocol == origin\.protocol && url\.port == origin\.port\) \{\s+for \(\(k, v\) in r\.headers\) c\.setRequestProperty\(k, v\)/)
    expect(kotlin).toContain('c.instanceFollowRedirects = false')
  })

  it('the measurement and the Swift check exist', () => {
    expect(read('scripts/mobile/ios-redirect-header-probe.sh')).toContain('the system no longer drops Authorization at a redirect')
    expect(read('scripts/mobile/native-guard-tests.sh')).toContain('NetGuard.headersForSystemTransfer(["Authorization": "Bearer hf_x", "X-Api-Key": "k"')
  })
})
