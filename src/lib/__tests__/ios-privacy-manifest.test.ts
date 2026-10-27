/**
 * Das iOS-Datenschutz-Manifest und der sendende Code sagen dasselbe.
 *
 * `PrivacyInfo.xcprivacy` erklaert je erhobenem Datentyp, ob er mit dem Konto
 * verknuepft ist (NSPrivacyCollectedDataTypeLinked). Die Angabe muss zu dem
 * passen, was das Handy wirklich sendet, und zu den Angaben in App Store
 * Connect. Runde 8: Der Zaehler des Cloud-Schalters stand als verknuepft im
 * Manifest, das Handy sendet ihn aber ohne Sitzung.
 *
 * Der Waechter liest Quellen, er sendet nichts:
 *   1  Die Liste der erklaerten Typen ist bekannt. Ein neuer Typ braucht hier
 *      eine Zeile mit seinem Anker im Code.
 *   2  Nicht verknuepft (Zaehler): Unter src/mobile ruft niemand den Zaehler je
 *      Konto, und was `funnel_ping` sendet, traegt nichts vom Nutzer.
 *   3  Verknuepft (Konto, Inhalte, Bilder, Sprache): Die Aufrufe laufen ueber
 *      `cloudFetch` oder eine Sitzung, also mit dem Token des Kontos.
 *
 * Aendert sich der Code, schlaegt der Test fehl und nennt die Angabe, die dann
 * im Manifest UND in App Store Connect zu aendern ist.
 *
 * Grenze: Geprueft sind direkte Importe aus src/mobile, keine Ketten ueber
 * dritte Dateien. Was der Server speichert, steht nicht in diesem Repo.
 *
 * Lauf: npx vitest run src/lib/__tests__/ios-privacy-manifest.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (rel: string): string => readFileSync(join(root, rel), 'utf8')
const MANIFEST = 'src-tauri/gen/apple/locally-uncensored_iOS/PrivacyInfo.xcprivacy'

interface Declared {
  linked: boolean
  tracking: boolean
  purposes: string[]
}

/** Die erklaerten Datentypen des Manifests, ohne das Praefix von Apple. */
function declaredTypes(xml: string): Map<string, Declared> {
  const start = xml.indexOf('<key>NSPrivacyCollectedDataTypes</key>')
  expect(start, 'NSPrivacyCollectedDataTypes fehlt').toBeGreaterThan(-1)
  const out = new Map<string, Declared>()
  for (const m of xml.slice(start).matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
    const body = m[1]
    const type = /<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataType(\w+)<\/string>/.exec(body)?.[1]
    const linked = /<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<(true|false)\/>/.exec(body)?.[1]
    const tracking = /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<(true|false)\/>/.exec(body)?.[1]
    if (!type || !linked || !tracking) throw new Error(`Eintrag ohne Typ, Linked oder Tracking: ${body.trim().slice(0, 120)}`)
    const purposes = [...body.matchAll(/<string>NSPrivacyCollectedDataTypePurpose(\w+)<\/string>/g)].map((p) => p[1])
    expect(out.has(type), `${type} steht zweimal im Manifest`).toBe(false)
    out.set(type, { linked: linked === 'true', tracking: tracking === 'true', purposes })
  }
  return out
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sources(rel))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(rel)
  }
  return out
}

/** Die Dateien, die eine Quelle direkt und relativ importiert. */
function importsOf(rel: string): string[] {
  const out: string[] = []
  for (const m of read(rel).matchAll(/from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const base = join(dirname(join(root, rel)), m[1] ?? m[2])
    for (const end of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
      if (existsSync(base + end)) out.push(relative(root, base + end).split('\\').join('/'))
    }
  }
  return out
}

const manifest = read(MANIFEST)
const declared = declaredTypes(manifest)

describe('iOS-Datenschutz-Manifest: erklaerte Daten und sendender Code', () => {
  it('erklaert genau die bekannten Datentypen, keiner dient dem Tracking', () => {
    expect([...declared.keys()].sort()).toEqual(['AudioData', 'EmailAddress', 'OtherUserContent', 'PhotosorVideos', 'ProductInteraction', 'UserID'])
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/)
    for (const [type, d] of declared) expect(d.tracking, `${type}: Tracking`).toBe(false)
    expect(declared.get('ProductInteraction')?.purposes).toEqual(['Analytics'])
    for (const type of ['AudioData', 'EmailAddress', 'OtherUserContent', 'PhotosorVideos', 'UserID']) {
      expect(declared.get(type)?.purposes, type).toEqual(['AppFunctionality'])
    }
  })

  describe('Zaehler des Cloud-Schalters (ProductInteraction): nicht verknuepft', () => {
    // Wer den Zaehler je Konto sendet oder ruft. Der Desktop darf das, das Handy nicht.
    const PER_ACCOUNT = /reportCloudSwitch\s*\(|reportCloudSwitchForAccount|\/api\/funnel\/switch/
    const all = sources('src')
    const perAccount = all.filter((f) => PER_ACCOUNT.test(read(f)) && f !== 'src/api/cloud/switch-counter.ts')
    const phone = all.filter((f) => f.startsWith('src/mobile/'))

    it('das Manifest sagt "nicht verknuepft"', () => {
      expect(declared.get('ProductInteraction')?.linked).toBe(false)
    })

    it('unter src/mobile sendet und ruft niemand den Zaehler je Konto', () => {
      expect(perAccount, 'der Anker fehlt: api/funnel.ts kennt den Zaehler je Konto nicht mehr').toContain('src/api/funnel.ts')
      const why = 'Das Handy zaehlt jetzt je Konto. Dann: NSPrivacyCollectedDataTypeLinked fuer ProductInteraction auf true, App Store Connect und den Text der Seite Privacy nachziehen.'
      expect(perAccount.filter((f) => f.startsWith('src/mobile/')), why).toEqual([])
      const reached = phone.flatMap((f) => importsOf(f).filter((i) => perAccount.includes(i) && i !== 'src/api/funnel.ts').map((i) => `${f} -> ${i}`))
      expect(reached, why).toEqual([])
      // api/funnel.ts selbst darf das Handy nur fuer die anonyme Haelfte oder die Namen der Ereignisse lesen.
      const funnelUsers = phone.filter((f) => importsOf(f).includes('src/api/funnel.ts'))
      for (const f of funnelUsers) expect(read(f), `${f}: ${why}`).not.toMatch(PER_ACCOUNT)
    })

    it('der Zaehler des Handys ruft nur die anonyme Haelfte, und die geht nicht ueber die Sitzung', () => {
      const counter = read('src/api/cloud/switch-counter.ts').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(counter).toContain('reportCloudSwitchAnonymous(action)')
      expect(counter).not.toMatch(PER_ACCOUNT)
      const funnel = read('src/api/funnel.ts')
      const from = funnel.indexOf('export function reportCloudSwitchAnonymous')
      const anonymous = funnel.slice(from, funnel.indexOf('\n}\n', from))
      expect(anonymous).toContain("backendCall('funnel_ping', { event })")
      expect(anonymous).not.toMatch(/cloudFetch|getAccessToken|session|token/)
    })

    it('funnel_ping sendet Ereignis, Plattform und App-Version, sonst nichts', () => {
      const rust = read('src-tauri/src/commands/funnel.rs')
      const from = rust.indexOf('pub(crate) fn funnel_payload')
      const payload = rust.slice(from, rust.indexOf('\n}\n', from))
      expect([...payload.matchAll(/"(p_[a-z_]+)"\s*:/g)].map((m) => m[1]).sort()).toEqual(['p_app_version', 'p_event', 'p_platform'])
      const cmdFrom = rust.indexOf('pub async fn funnel_ping')
      const command = rust.slice(cmdFrom, rust.indexOf('#[cfg(test)]', cmdFrom))
      // Der Schluessel im Kopf ist der oeffentliche des Projekts, nicht der eines Nutzers.
      expect(command).toContain('format!("Bearer {LUC_SUPABASE_ANON_KEY}")')
      expect(command).not.toMatch(/user_id|email|access_token|session|device_id|identifier_for_vendor/i)
    })
  })

  describe('Konto, Inhalte, Bilder, Sprache: verknuepft', () => {
    const why = (type: string) => `${type} geht nicht mehr mit dem Konto hinaus. Dann die Angabe Linked fuer ${type} im Manifest und in App Store Connect pruefen.`

    it('das Manifest sagt "verknuepft"', () => {
      for (const type of ['EmailAddress', 'UserID', 'OtherUserContent', 'PhotosorVideos', 'AudioData']) {
        expect(declared.get(type)?.linked, type).toBe(true)
      }
    })

    it('cloudFetch haengt an jeden Aufruf das Token des Kontos und sendet ohne Token nicht', () => {
      const client = read('src/api/cloud/client.ts')
      const from = client.indexOf('export async function cloudFetch')
      const body = client.slice(from)
      expect(body).toContain("if (!token) throw new CloudJobError('not signed in', 401)")
      expect(body).toContain('headers.set(\'authorization\', `Bearer ${token}`)')
    })

    it('EmailAddress und UserID: die Anmeldung des Handys geht mit E-Mail an das Konto', () => {
      const auth = read('src/mobile/screens/settings/parts/auth.ts')
      expect(auth, why('EmailAddress')).toMatch(/auth\.signInWithPassword\(\{ email/)
      expect(auth, why('EmailAddress')).toMatch(/auth\.signUp\(\{ email/)
    })

    it('OtherUserContent und PhotosorVideos: Auftraege und ihre Quelldateien laufen ueber cloudFetch', () => {
      const jobs = read('src/api/cloud/jobs.ts')
      expect(jobs, why('PhotosorVideos')).toMatch(/cloudFetch\(`\/api\/jobs\/upload\?role=/)
      expect(jobs, why('OtherUserContent')).toMatch(/cloudFetch\('\/api\/jobs',/)
      expect(jobs.replace(/cloudFetch\(/g, ''), 'jobs.ts ruft fetch an cloudFetch vorbei').not.toMatch(/\bfetch\(/)
    })

    it('OtherUserContent: Erinnerungen gehen mit dem Token der Sitzung', () => {
      expect(read('src/api/cloud/memory-sync.ts'), why('OtherUserContent')).toContain('headers: { authorization: `Bearer ${token}`')
    })

    it('AudioData: das Diktat geht ueber cloudFetch', () => {
      expect(read('src/api/voice.ts'), why('AudioData')).toMatch(/cloudFetch\(\s*["']\/api\/voice\/transcribe["']/)
    })
  })
})
