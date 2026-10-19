import type { Connect } from 'vite'
import type { RouteMount } from './routes'

/** Die dreizehn Remote-Access-Endpunkte, die es im reinen Vite-Prozess nicht gibt. */
export function registerRemoteStubs(routes: RouteMount): void {
  // ─── Remote Access stubs (dev mode) ───────────────────────────
  // Reported by a user on v2.4.2: clicking LAN/Internet from
  // `npm run dev` returned an HTML 404 page that the frontend then
  // tried to JSON.parse, producing a cryptic
  // "SyntaxError: unexpected character at line 1 column 1" stacktrace.
  //
  // Remote Access is fundamentally a Tauri-only feature: a Rust axum
  // server, JWT auth, Cloudflare tunnel binary management,
  // mobile-UI static serve. None of that exists in the vite dev
  // process. Mirroring it here would mean reimplementing ~3700 lines
  // of Rust in Node middleware plus a forever maintenance burden.
  //
  // Instead: respond with HTTP 501 + a structured JSON body so the
  // frontend can surface a clear actionable error. The Sidebar +
  // remoteStore already short-circuit before fetch() in dev mode
  // (REMOTE_DEV_MODE_ERROR); these stubs are the backstop for any
  // future caller that bypasses those guards.
  const REMOTE_DEV_MODE_BODY = JSON.stringify({
    error: "Remote Access requires the installed desktop app. Use `npm run tauri:dev` for full Remote in development — the plain vite dev server can't host the Rust backend Remote needs.",
    devModeOnly: true,
  })
  const remoteStubPaths = [
    '/local-api/start-remote-server',
    '/local-api/stop-remote-server',
    '/local-api/restart-remote-server',
    '/local-api/remote-server-status',
    '/local-api/regenerate-remote-token',
    '/local-api/remote-qr-code',
    '/local-api/remote-connected-devices',
    '/local-api/disconnect-remote-device',
    '/local-api/set-remote-permissions',
    '/local-api/set-remote-page-title',
    '/local-api/start-tunnel',
    '/local-api/stop-tunnel',
    '/local-api/tunnel-status',
  ]
  const remoteDevModeStub: Connect.SimpleHandleFunction = (_req, res) => {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end(REMOTE_DEV_MODE_BODY)
  }
  for (const path of remoteStubPaths) {
    routes.use(path, remoteDevModeStub)
  }

  // The Local API usage counter (local_api_usage) and the download speed
  // limit (set_download_limit) live in the Rust process as well. Both callers
  // already tolerate a failure: the panel shows no numbers, and the limit is
  // only sent from the desktop app.
  const DESKTOP_ONLY_BODY = JSON.stringify({
    error: 'This needs the installed desktop app. The plain vite dev server has no Rust backend.',
    devModeOnly: true,
  })
  // The training photos of a local character (character_photos) too: the
  // caller asks only inside the desktop app. The GGUF file dialog of the
  // Model Manager (pick_gguf_file) is a native dialog of the Rust process.
  // The node pack manager (list_custom_nodes, remove_custom_node,
  // custom_node_log) too: listing, the trash and the install log are Rust.
  // Check files and Repair of the Model Manager (GH #113): the digest job
  // and the Trash are Rust.
  for (const path of [
    '/local-api/local-api-usage', '/local-api/set-download-limit', '/local-api/character-photos', '/local-api/pick-gguf-file',
    '/local-api/list-custom-nodes', '/local-api/remove-custom-node', '/local-api/custom-node-log',
    '/local-api/verify-model-files', '/local-api/verify-model-files-status', '/local-api/verify-model-files-cancel',
    '/local-api/trash-model-file',
  ]) {
    routes.use(path, (_req, res) => {
      res.writeHead(501, { 'Content-Type': 'application/json' })
      res.end(DESKTOP_ONLY_BODY)
    })
  }
}
