import { defineConfig, loadEnv, parseAst, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'path'
import { readFileSync } from 'fs'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import {
  applyConsoleRemovals,
  collectConsoleRemovals,
  isStrippableModule,
} from './src/dev/console-strip'
import { assertStoreBuild } from './src/dev/store-build-check'
import { ABSENT_PACKAGES } from './src/dev/absent-packages'
import { WEBVIEW_BUILD_TARGET, checkBundle, describeViolations, type BuiltFile } from './src/dev/webview-target'
import { PHONE_VERSION_CONSTANT, phoneVersionDefine, withPhoneVersionMeta } from './src/dev/phone-version'
// ── Der Dev-Server steht nicht mehr hier ────────────────────────────────────
//
// Bis ZB-7 waren 2 120 der 2 536 Zeilen dieser Datei ein vollständiger
// HTTP-Server: 44 Endpunkte, der ComfyUI-Kindprozess, der Whisper-Prozess, der
// SSRF-Wächter, der Pfad-Käfig. Die Build-Konfiguration ist die eine Datei, die
// jeder anfassen muss — und an dieser hing kein einziger Test, weil jeder
// Handler nur über einen echten `ViteDevServer` erreichbar war.
//
// Er liegt jetzt in `dev-server/`, in Modulen, die je EINEN Zustand besitzen,
// und seine Handler hängen an einer Schnittstelle mit genau einer Methode
// (`RouteMount`), sodass ein Test sie auf einen echten node:http-Server hängen
// und mit echten Anfragen beschiessen kann — dieselben Handler, die
// `npm run dev` ausliefert. Siehe dev-server/index.ts.
import { devServerPlugin } from './dev-server/index'

// Load .env file from project root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '.env') })

// The port the dev server binds and the only port the /local-api origin check
// treats as canonical. Kept in ONE place so the two can't drift apart — an
// origin allowlist that names a port the server no longer listens on silently
// degrades to "loopback regex only".
//
// 5273 bleibt die Voreinstellung: `src-tauri/tauri.conf.json` (devUrl) und
// `playwright.config.ts` nennen sie beide. `LU_DEV_PORT` ist der Weg, den
// Server ein ZWEITES Mal zu starten, ohne diese Datei zu ändern — genau das
// braucht, wer neben einem laufenden e2e-Lauf etwas nachmessen will.
const DEV_PORT = Number(process.env.LU_DEV_PORT) || 5273

// §1.6 — Strip console.log/info/debug from PRODUCTION builds, keep warn/error.
//
// Why a hand-rolled plugin instead of a minify option: Vite 8 here is
// rolldown-based and uses the oxc minifier (the build literally logs
// "Both esbuild and oxc options were set. oxc options will be used and
// esbuild options will be ignored" — so the old `esbuild: { drop, pure }`
// block was DEAD and console.* shipped). rolldown@1.0.2's oxc
// `CompressOptions` exposes only an all-or-nothing `dropConsole: boolean`
// (no Terser-style `pure_funcs`), which would also strip warn/error — and
// rolldown-vite doesn't reliably plumb it through anyway (vitejs/rolldown-vite#302).
// So we AST-remove the three noisy methods ourselves and leave warn/error
// intact so genuine problems still surface in a power user's devtools.
//
// Uses Vite's built-in `parseAst` (oxc parser, ESTree output with byte
// offsets) — no new dependency. Production sourcemaps are off here
// (`build.sourcemap` unset → default false), so returning transformed code
// without a map is safe; the guard below also bails when a map is requested.
//
// Bleibt hier, wo der Rest der Build-Konfiguration steht: `apply: 'build'`, es
// läuft also NICHT im Dev-Server, und seine Logik liegt ohnehin schon getestet
// in src/dev/console-strip.ts.
// A store build of the phone app that cannot keep its promises is not built
// (durchsicht-mobile M4, M5): the preset `play` or `appstore` without the
// address of the report service, or a preset the app does not know. The rule
// and its test live in src/dev/store-build-check.ts. `apply: 'build'`: the dev
// server and vitest never ask.
function storeBuildCheckPlugin(): Plugin {
  return {
    name: 'lu-store-build-check',
    apply: 'build',
    config(_config, { mode }) {
      // What the bundle will see: .env files of the mode, then the shell.
      const env = { ...loadEnv(mode, __dirname, 'VITE_LU_'), ...process.env }
      assertStoreBuild({
        VITE_LU_STORE_PRESET: env.VITE_LU_STORE_PRESET,
        VITE_LU_REPORT_URL: env.VITE_LU_REPORT_URL,
        VITE_LU_BUILD_TARGET: env.VITE_LU_BUILD_TARGET,
        TAURI_ENV_PLATFORM: env.TAURI_ENV_PLATFORM,
      })
    },
  }
}

// The phone bundle is the build that names itself: the phone build scripts and
// the phone configuration of Tauri set VITE_LU_BUILD_TARGET=mobile. A build
// without the variable is the desktop package (src/main.tsx).
const PHONE_BUNDLE = process.env.VITE_LU_BUILD_TARGET === 'mobile'

// The oldest web view the phone app is built for (src/dev/webview-target.ts).
// The build target lowers syntax to it. A FUNCTION the web view does not have
// is not lowered by anybody, so this reads every built file and stops the
// build when one is used above the floor without a polyfill or a guard:
// "Promise.withResolvers is not a function" on Android System WebView 113
// was found on a phone (acceptance Android 8 GB, B5), and belongs here.
// The desktop package is not asked: its web views are not the phone's.
function webviewTargetPlugin(): Plugin {
  return {
    name: 'lu-webview-target',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (!PHONE_BUNDLE) return
      const files: BuiltFile[] = []
      for (const [name, item] of Object.entries(bundle)) {
        if (!/\.(?:m?js|css)$/.test(name)) continue
        const body = item.type === 'chunk' ? item.code : item.source
        files.push({ name, text: typeof body === 'string' ? body : Buffer.from(body).toString('utf8') })
      }
      const violations = checkBundle(files)
      if (violations.length > 0) this.error(describeViolations(violations))
    },
  }
}

// The phone app shows the version of the PHONE package, which need not be the
// desktop's (src/dev/phone-version.ts). The phone bundle gets it as a build
// constant, read from the same field Tauri turns into versionName and
// CFBundleShortVersionString, and says it once more in index.html, so the
// release scripts can check a finished page against the package it went into.
// The desktop bundle gets neither: nothing is defined, nothing is added.
const PHONE_DEFINE = phoneVersionDefine(__dirname, { VITE_LU_BUILD_TARGET: process.env.VITE_LU_BUILD_TARGET, TAURI_ENV_PLATFORM: process.env.TAURI_ENV_PLATFORM })

function phoneVersionPlugin(): Plugin {
  return {
    name: 'lu-phone-version',
    transformIndexHtml(html) {
      const version = PHONE_DEFINE[PHONE_VERSION_CONSTANT]
      return version ? withPhoneVersionMeta(html, JSON.parse(version) as string) : html
    },
  }
}

function stripConsolePlugin(): Plugin {
  return {
    name: 'lu-strip-console',
    apply: 'build',
    transform(code, id) {
      if (!isStrippableModule(id, code)) return null

      let ast: unknown
      try {
        ast = parseAst(code, { sourceType: 'module' })
      } catch {
        return null // let the real parse step report syntax errors
      }

      const removals = collectConsoleRemovals(ast)
      if (removals.length === 0) return null

      // Sourcemaps are off for prod here; null map signals "I rewrote the
      // text, don't trust a passthrough map" without fabricating one.
      return { code: applyConsoleRemovals(code, removals), map: null }
    },
  }
}

// The app's own Content-Security-Policy on the dev server, opt-in (LU_E2E_CSP=1).
//
// The policy lives in src-tauri/tauri.conf.json and only the packaged app
// enforces it, so a browser run against the plain dev server proves nothing
// about what the policy blocks. That is how the voice session's audio worklets
// passed every browser check and were then refused in the app: they came from
// blob: URLs, and the policy allows scripts from 'self' only.
//
// With the switch on, index.html carries the exact policy as a meta tag (a
// meta tag, not a response header rewritten in the browser: Chromium would
// treat such a page as coming from an unknown network and refuse its loopback
// requests, which is not what happens in the app). Hot reload is off in that
// mode because its inline preamble is itself something the policy refuses.
const E2E_CSP = process.env.LU_E2E_CSP === '1'

function appCspPlugin(): Plugin {
  return {
    name: 'lu-app-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      const conf = JSON.parse(readFileSync(resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf8'))
      const policy = String(conf.app.security.csp).replace(/"/g, '&quot;')
      return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`)
    },
  }
}

export default defineConfig({
  // §1.6: `stripConsolePlugin` (apply:'build') removes console.log/info/debug
  // from production output while keeping warn/error. It replaces the old
  // `esbuild: { drop, pure }` block, which was silently ignored under
  // Vite 8's oxc minifier (the build warned about exactly that) — so
  // console.* used to ship. See the plugin definition above for why oxc's
  // own dropConsole can't be used (all-or-nothing, no warn/error carve-out).
  // Packages a dependency imports and LU must not ship (the Daily call client
  // with Sentry). The same list is in vitest.config.ts.
  resolve: { alias: ABSENT_PACKAGES },
  plugins: [react(), tailwindcss(), storeBuildCheckPlugin(), stripConsolePlugin(), webviewTargetPlugin(), phoneVersionPlugin(), devServerPlugin({ port: DEV_PORT }), ...(E2E_CSP ? [appCspPlugin()] : [])],
  // The phone bundle names the web view it is built for. The desktop package
  // keeps the default of Vite, as before.
  ...(PHONE_BUNDLE ? { build: { target: WEBVIEW_BUILD_TARGET }, define: PHONE_DEFINE } : {}),
  server: {
    ...(E2E_CSP ? { hmr: false } : {}),
    // The Rust build tree churns thousands of files per `cargo build`; watching
    // it starves the dev server on a `tauri:dev` run.
    watch: { ignored: ['**/src-tauri/target/**'] },
    port: DEV_PORT,
    cors: true,
    // `true` switched Vite's host-header check off completely. This dev server
    // is not a developer convenience here — setup.sh / start.bat ship it as the
    // user's runtime, with /local-api/shell-execute and /local-api/execute-code
    // mounted on it, so any web page the user happened to have open could point
    // its own domain at 127.0.0.1 and talk to those endpoints as if it were the
    // app. Vite waves through bare IP literals and localhost regardless, so the
    // job of this list is only to withhold arbitrary DNS names; reaching the
    // dev server over a LAN hostname is an opt-in that belongs in here by name.
    allowedHosts: ['localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        // Issue #31: honour OLLAMA_HOST so `OLLAMA_HOST=0.0.0.0:11434 npm run dev`
        // and remote Ollama setups (Docker, LAN, homelab) just work in dev mode
        // too. Accept bare `host:port`, scheme-less host, or full URL.
        target: (() => {
          const raw = (process.env.OLLAMA_HOST || '').trim()
          if (!raw) return 'http://localhost:11434'
          if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '')
          return `http://${raw.replace(/\/+$/, '')}`
        })(),
        changeOrigin: true,
      },
      '/ollama-search': {
        target: 'https://ollama.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama-search/, '/search'),
      },
      '/comfyui': {
        target: 'http://localhost:8188',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/comfyui/, ''),
        ws: true,
      },
      '/civitai-api': {
        target: 'https://civitai.com/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/civitai-api/, ''),
      },
    },
  },
})
