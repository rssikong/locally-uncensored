/**
 * Fund 4 aus T8 (Ubuntu 22.04 und 26.04, AppImage der 3.0.0, 11.09.), Punkt 5:
 * auf beiden Kisten standen DREI Zeilen `[Linux] Wayland session:` auf der
 * Konsole, eine je Notbehelf. Das Handbuch auf locallyuncensored.com sagte an
 * zwei Stellen "two environment variables" und nannte nur
 * WEBKIT_DISABLE_DMABUF_RENDERER und WEBKIT_DISABLE_COMPOSITING_MODE. Der
 * dritte, LD_PRELOAD auf die System-libwayland-client, fehlte, und mit ihm der
 * einzige Schalter, der alle drei abstellt.
 *
 * Der Waechter zaehlt die Wahrheit dort, wo sie steht: in
 * `src-tauri/src/lib.rs`, Funktion `linux_webview_env`. Rust wird hier nur
 * GELESEN. Steigt oder faellt die Zahl, faellt dieser Test auf und das
 * Handbuch muss mit.
 *
 * Lauf: npx vitest run src/lib/__tests__/das-handbuch-zaehlt-die-wayland-notbehelfe-richtig.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const MAIN_RS = readFileSync('src-tauri/src/lib.rs', 'utf8')
const INSTALL = readFileSync('docs/guide/install/index.html', 'utf8')
const TROUBLE = readFileSync('docs/guide/settings-and-troubleshooting/index.html', 'utf8')

/** Der Rumpf von `linux_webview_env`, und nur der: die Tests darunter setzen
 *  dieselben Namen noch einmal und wuerden sonst mitgezaehlt. */
const PLAN = MAIN_RS.slice(
  MAIN_RS.indexOf('pub(crate) fn linux_webview_env'),
  MAIN_RS.indexOf('/// Is this a Wayland session?'),
)

describe('was der Code unter Wayland wirklich setzt', () => {
  const notbehelfe = PLAN.match(/out\.push\(WebviewEnv \{/g) ?? []

  it('drei Notbehelfe, nicht zwei', () => {
    expect(notbehelfe).toHaveLength(3)
    for (const schluessel of [
      'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_DISABLE_COMPOSITING_MODE', 'LD_PRELOAD',
    ]) {
      expect(PLAN, schluessel).toContain(schluessel)
    }
    // Positivkontrolle: der Ausschnitt ist wirklich die Funktion und nicht leer.
    expect(PLAN.length).toBeGreaterThan(200)
  })

  it('und einen Schalter, der alle abstellt', () => {
    expect(MAIN_RS).toContain('WAYLAND_OPT_OUT: &str = "LU_NO_WAYLAND_WORKAROUND"')
  })
})

describe('das Handbuch sagt dasselbe', () => {
  it('nennt keine falsche Zahl mehr', () => {
    for (const [name, seite] of [['install', INSTALL], ['troubleshooting', TROUBLE]] as const) {
      expect(seite, name).not.toContain('two environment variables')
    }
  })

  it('nennt alle drei Variablen und den Schalter', () => {
    for (const schluessel of [
      'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_DISABLE_COMPOSITING_MODE', 'LD_PRELOAD',
      'LU_NO_WAYLAND_WORKAROUND',
    ]) {
      expect(INSTALL, schluessel).toContain(schluessel)
    }
  })
})
