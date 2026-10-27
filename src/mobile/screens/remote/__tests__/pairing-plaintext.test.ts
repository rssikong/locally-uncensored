/**
 * Review M11: on Wi-Fi the pairing code and the session token travel as
 * plain text. That cannot be fixed on the phone alone, so the app has to say
 * it where the user pairs, and the code must never reach a log.
 *
 * Run: npx vitest run src/mobile/screens/remote/__tests__/pairing-plaintext.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { REMOTE_STRINGS } from '../../../strings/remote'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../../../..')

function files(dir: string, keep: RegExp): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules' || name === 'build' || name === 'target' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...files(full, keep))
    else if (keep.test(name)) out.push(full)
  }
  return out
}

describe('the pairing page says what Wi-Fi means', () => {
  it('names the code, other people on the network, and the own trusted network', () => {
    const note = REMOTE_STRINGS.connect.insecureNote
    expect(note).toMatch(/nothing is encrypted/i)
    expect(note).toMatch(/code/)
    expect(note).toMatch(/others on the same network/)
    expect(note).toMatch(/your own network, one you trust/)
    expect(note).toMatch(/never on public or shared Wi-Fi/)
  })

  it('shows it before an address is typed and for every plain address, not for https, the same machine or a sealed QR code', () => {
    const page = readFileSync(join(HERE, '../ConnectPage.tsx'), 'utf8')
    expect(page).toMatch(/\{!sealedMode && \(!target \|\| \(!target\.secure && target\.route !== 'loopback'\)\) \? \(\s*<p className="m-cap" data-testid="m-remote-connect-insecure">\s*\{S\.connect\.insecureNote\}/)
  })

  it('says the same on the help page and in the connection sheet', () => {
    expect(REMOTE_STRINGS.help.private.join(' ')).toMatch(/the code, your messages and the key of the session travel without encryption/)
    expect(REMOTE_STRINGS.connection.insecure).toMatch(/not encrypted/)
    expect(REMOTE_STRINGS.connection.insecure).toMatch(/your own network/)
  })

  it('has no dash in these sentences', () => {
    for (const text of [REMOTE_STRINGS.connect.insecureNote, REMOTE_STRINGS.connection.insecure, ...REMOTE_STRINGS.help.private]) {
      expect(text).not.toMatch(/[–—]/)
    }
  })
})

describe('the pairing code never reaches a log', () => {
  /** A log call whose arguments mention the code, the body of the pairing call, or a whole link. */
  const LOGS_A_CODE = /(?:\blog\.(?:debug|info|warn|error)|console\.(?:log|info|warn|error|debug))\(([^)]*)\)/g
  const TELLS = /passcode|\bcode\b|\bbody\b|offer\.url|\burl\b|link/i

  it('in the phone shell: remote client, pairing pages, deep links', () => {
    const sources = [
      ...files(join(ROOT, 'src/mobile/remote'), /\.tsx?$/),
      ...files(join(ROOT, 'src/mobile/screens/remote'), /\.tsx?$/),
      join(ROOT, 'src/mobile/nav/deeplink.ts'),
      join(ROOT, 'src/mobile/resilience/LinkOfferSheet.tsx'),
      join(ROOT, 'src/lib/incoming-url.ts'),
    ]
    expect(sources.length).toBeGreaterThan(10)
    const hits: string[] = []
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(LOGS_A_CODE)) {
        // The sentence of the log line may say "link"; what counts is what is handed to it.
        if (TELLS.test(m[1].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ''))) hits.push(`${file.slice(ROOT.length + 1)}: ${m[0].slice(0, 100)}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('in the native transport: the Rust plugin and its command write no log line at all about a request', () => {
    const remote = readFileSync(join(ROOT, 'src-tauri/plugins/lu-native/src/remote.rs'), 'utf8')
    const code = remote.slice(0, remote.indexOf('#[cfg(test)]'))
    expect(code).not.toMatch(/tracing::|log::|println!|eprintln!|dbg!/)
    // An error text is made of words, never of the request.
    expect(code).toMatch(/fn transport_error\(error: &reqwest::Error\) -> String/)
    const command = readFileSync(join(ROOT, 'src-tauri/src/commands/mobile_native.rs'), 'utf8')
    const call = command.slice(command.indexOf('pub async fn remote_client_request('))
    expect(call.slice(0, call.indexOf('\n}\n'))).not.toMatch(/tracing::|println!|eprintln!|dbg!/)
  })

  it('the code is sent in the body of the call, not in the address', () => {
    const client = readFileSync(join(ROOT, 'src/mobile/remote/remoteClient.ts'), 'utf8')
    expect(client).toMatch(/raw\('\/remote-api\/auth', \{[\s\S]{0,80}body: JSON\.stringify\(\{ passcode: clean \}\)/)
  })
})
