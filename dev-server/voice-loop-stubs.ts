import type { Connect } from 'vite'
import type { RouteMount } from './routes'

/**
 * The Astra voice loop is installed and run by the Rust process
 * (src-tauri/src/commands/voice_loop.rs). The plain Vite dev server has no
 * Rust process, so every voice loop endpoint answers with an honest HTTP 501
 * and a sentence, the same way the Remote Access and MLX stubs do. The
 * wrappers in src/api/voice-loop.ts already refuse before they get here;
 * these are the backstop for a caller that goes around them.
 */
export function registerVoiceLoopStubs(routes: RouteMount): void {
  const VOICE_LOOP_DEV_MODE_BODY = JSON.stringify({
    error: 'The voice loop needs the installed desktop app. Use `npm run tauri:dev` to run it in development.',
    devModeOnly: true,
    status: 'error',
    installed: false,
    running: false,
  })
  const voiceLoopStubPaths = [
    '/local-api/voice-loop-requirements',
    '/local-api/voice-loop-install',
    '/local-api/voice-loop-install-status',
    '/local-api/voice-loop-install-cancel',
    '/local-api/voice-loop-status',
    '/local-api/voice-loop-start',
    '/local-api/voice-loop-set-voice',
    '/local-api/voice-loop-stop',
    '/local-api/voice-loop-uninstall',
    // The key of the LU Engine lives in the Rust process (engine_key.rs);
    // only the voice service asks for it.
    '/local-api/engine-key-for',
    // The grant that lets a voice session leave its folder is given by the
    // Rust file jail after a native question. No Rust process, no grant.
    '/local-api/fs-whole-computer',
    '/local-api/fs-whole-computer-forget',
  ]
  const voiceLoopDevModeStub: Connect.SimpleHandleFunction = (_req, res) => {
    res.writeHead(501, { 'Content-Type': 'application/json' })
    res.end(VOICE_LOOP_DEV_MODE_BODY)
  }
  for (const path of voiceLoopStubPaths) {
    routes.use(path, voiceLoopDevModeStub)
  }
}
