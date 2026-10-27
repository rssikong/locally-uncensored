/**
 * Waechter gegen das Auseinanderlaufen von Nachbau und Original.
 *
 * Die Tests des Remote-Clients laufen gegen `fakeDesktop.ts`, nicht gegen den
 * echten Server aus `src-tauri/src/commands/remote.rs`. Ein echter
 * Integrationstest ist offen (siehe mobile-docs/REMOTE-PROTOKOLL.md). Bis
 * dahin prueft diese Datei am Quelltext, dass die Regeln, die der Nachbau
 * nachstellt und auf die der Client reagiert, im Original noch so dastehen.
 * Schlaegt hier etwas an, muessen Nachbau, Client und Doku nachgezogen werden.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PASSCODE_LENGTH, REMOTE_DEFAULT_PORT } from '../pairingLink'
import { CHAT_EVENT_MAX_BYTES, MAX_SESSION_MS, MEMORY_REVOKED_HEADER, REFRESH_HEADER, TOKEN_TTL_MS } from '../remoteClient'
import * as fake from './fakeDesktop'

const root = resolve(__dirname, '../../../..')
const rs = readFileSync(resolve(root, 'src-tauri/src/commands/remote.rs'), 'utf8')
const page = readFileSync(resolve(root, 'mobile-client/client.js'), 'utf8')
const proxy = readFileSync(resolve(root, 'src-tauri/src/commands/proxy.rs'), 'utf8')

/** Wert einer `const NAME: u64 = <Ausdruck>;` aus Rust, mit ausgerechnetem Produkt. */
function rustConst(name: string): number {
  const m = new RegExp(`const ${name}: \\w+ = ([^;]+);`).exec(rs)
  if (!m) throw new Error(`constant ${name} not found in remote.rs`)
  return m[1]
    .split('*')
    .map((part) => Number(part.trim().replace(/_/g, '')))
    .reduce((a, b) => a * b, 1)
}

describe('remote.rs steht noch so da, wie Client und Nachbau es annehmen', () => {
  it('Fristen und Grenzen', () => {
    expect(rustConst('PASSCODE_TTL_SECS')).toBe(fake.PASSCODE_TTL_SECS)
    expect(rustConst('JWT_TTL_SECS')).toBe(fake.JWT_TTL_SECS)
    expect(rustConst('JWT_TTL_SECS') * 1000).toBe(TOKEN_TTL_MS)
    expect(rustConst('MAX_SESSION_SECS')).toBe(fake.MAX_SESSION_SECS)
    expect(rustConst('MAX_SESSION_SECS') * 1000).toBe(MAX_SESSION_MS)
    expect(rustConst('MAX_FAILED_ATTEMPTS')).toBe(fake.MAX_FAILED_ATTEMPTS)
    expect(rustConst('COOLDOWN_SECS')).toBe(fake.COOLDOWN_SECS)
    expect(rustConst('CHAT_EVENT_MAX_CONTENT')).toBe(CHAT_EVENT_MAX_BYTES)
    expect(rustConst('CHAT_EVENT_MAX_CONTENT')).toBe(fake.CHAT_EVENT_MAX_CONTENT)
  })

  it('Code aus sechs Ziffern, Port 11435', () => {
    expect(rs.includes(`format!("{:0${PASSCODE_LENGTH}}", rng.gen_range(0..1000000))`), `format!("{:0${PASSCODE_LENGTH}}", rng.gen_range(0..1000000))`).toBe(true)
    expect(rs.includes(`port: ${REMOTE_DEFAULT_PORT},`), `port: ${REMOTE_DEFAULT_PORT},`).toBe(true)
  })

  it('Routen', () => {
    for (const route of [
      '.route("/remote-api/auth", post(handle_auth))',
      '.route("/remote-api/status", get(handle_status))',
      '.route("/remote-api/status/full", get(handle_status_full))',
      '.route("/remote-api/devices", get(handle_devices))',
      '.route("/remote-api/disconnect", post(handle_disconnect))',
      '.route("/remote-api/permissions", get(handle_get_permissions))',
      '.route("/remote-api/config", get(handle_config))',
      '.route("/remote-api/chat-event", post(handle_chat_event))',
      '.route("/remote-api/agent-tool", post(handle_agent_tool))',
      '.route("/api/{*rest}", any(proxy_ollama))',
      // Desktop 3.0.8 (A17): the page carries the title the desktop set.
      '.route("/mobile", get(mobile_landing_titled))',
      '.fallback(redirect_to_mobile)',
    ]) {
      expect(rs.includes(route), route).toBe(true)
    }
  })

  it('Antworten der Anmeldung, an denen der Client die Fehlerklasse festmacht', () => {
    expect(rs.includes('(StatusCode::UNAUTHORIZED, "Missing authorization")'), '(StatusCode::UNAUTHORIZED, "Missing authorization")').toBe(true)
    expect(rs.includes('(StatusCode::UNAUTHORIZED, "Invalid or expired token")'), '(StatusCode::UNAUTHORIZED, "Invalid or expired token")').toBe(true)
    expect(/StatusCode::UNAUTHORIZED, "Session ended . re-pair from the desktop\."/.test(rs), String(/StatusCode::UNAUTHORIZED, "Session ended . re-pair from the desktop\."/)).toBe(true)
    expect(rs.includes('(StatusCode::FORBIDDEN, "Invalid code")'), '(StatusCode::FORBIDDEN, "Invalid code")').toBe(true)
    expect(rs.includes('format!("Too many attempts. Try again in {}s", remaining)'), 'format!("Too many attempts. Try again in {}s", remaining)').toBe(true)
    expect(rs.includes('StatusCode::TOO_MANY_REQUESTS'), 'StatusCode::TOO_MANY_REQUESTS').toBe(true)
    // Desktop 3.0.8 (A17): the plain answer without the sealed channel, built in lan_status_body.
    expect(rs.includes('None => serde_json::json!({ "status": "ok" }),'), 'None => serde_json::json!({ "status": "ok" }),').toBe(true)
    expect(rs.includes('"app": "LU"'), '"app": "LU"').toBe(true)
    expect(rs.includes('"connected_devices": devices.len()'), '"connected_devices": devices.len()').toBe(true)
  })

  it('Kopfzeilen fuer Verlaengerung und Sperre', () => {
    expect(rs.includes(`response.headers_mut().insert("${REFRESH_HEADER}", hv)`), `response.headers_mut().insert("${REFRESH_HEADER}", hv)`).toBe(true)
    expect(rs.includes(`[("${MEMORY_REVOKED_HEADER}", "1")]`), `[("${MEMORY_REVOKED_HEADER}", "1")]`).toBe(true)
    expect(rs.includes('StatusCode::CONFLICT'), 'StatusCode::CONFLICT').toBe(true)
    expect(rs.includes('"Remote memory context was revoked.'), '"Remote memory context was revoked.').toBe(true)
  })

  it('kein CORS: deshalb braucht die App einen Rust-Transport', () => {
    expect(rs.includes('let cors = CorsLayer::new();'), 'let cors = CorsLayer::new();').toBe(true)
    expect(/^\s*let cors = CorsLayer::permissive\(\);/m.test(rs)).toBe(false)
  })

  it('der Desktop schickt Antworten am Stueck, nicht als Stream', () => {
    // proxy_to_target liest den ganzen Koerper des Backends, bevor es antwortet.
    const fn = rs.slice(rs.indexOf('async fn proxy_to_target('), rs.indexOf('// ─── #87: OpenAI-compatible bridge'))
    expect(fn.includes('match resp.bytes().await'), 'match resp.bytes().await').toBe(true)
    expect(fn.includes('bytes_stream')).toBe(false)
  })

  it('Rechte: alles aus als Vorgabe, und ein Geraet kann sie sich nicht selbst geben', () => {
    expect(/fn merge_remote_permissions\([^)]*\) -> RemotePermissions \{\s*let _ = body;\s*current\.clone\(\)\s*\}/.test(rs), String(/fn merge_remote_permissions\([^)]*\) -> RemotePermissions \{\s*let _ = body;\s*current\.clone\(\)\s*\}/)).toBe(true)
    expect(rs.includes('"shell_execute" | "code_execute" => ToolGate::Needs("shell")'), '"shell_execute" | "code_execute" => ToolGate::Needs("shell")').toBe(true)
    expect(rs.includes('"web_search" | "web_fetch" | "system_info" | "get_current_time" => ToolGate::Open'), '"web_search" | "web_fetch" | "system_info" | "get_current_time" => ToolGate::Open').toBe(true)
    expect(rs.includes('"needs_permission": true'), '"needs_permission": true').toBe(true)
  })

  it('Konfiguration und Spiegelung haben die Feldnamen, die der Client schickt und liest', () => {
    for (const field of ['"model": model', '"systemPrompt": system_prompt', '"platformLine": host_platform_prompt_line()']) {
      expect(rs.includes(field), field).toBe(true)
    }
    expect(rs.includes('#[serde(default, rename = "chatId", alias = "chat_id")]'), '#[serde(default, rename = "chatId", alias = "chat_id")]').toBe(true)
    expect(rs.includes('chat_title: String'), 'chat_title: String').toBe(true)
  })
})

describe('client.js macht noch, was der Client nachmacht', () => {
  it('Aufrufe und Felder', () => {
    expect(page.includes("fetch('/remote-api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:code})})"), "fetch('/remote-api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:code})})").toBe(true)
    expect(page.includes("r.headers.get('x-lu-refreshed-token')"), "r.headers.get('x-lu-refreshed-token')").toBe(true)
    expect(page.includes("Promise.all([authJson('/remote-api/config'), authJson('/api/tags')])"), "Promise.all([authJson('/remote-api/config'), authJson('/api/tags')])").toBe(true)
    expect(page.includes('var body = {model:currentModel, messages:apiMsgs, stream:true, options:{num_predict:16384}};'), 'var body = {model:currentModel, messages:apiMsgs, stream:true, options:{num_predict:16384}};').toBe(true)
    expect(page.includes("if(r.status===400 && ('think' in body)){"), "if(r.status===400 && ('think' in body)){").toBe(true)
    expect(page.includes("body: JSON.stringify({tool:tool, args:args||{}, chatId: currentChatId || ''})"), "body: JSON.stringify({tool:tool, args:args||{}, chatId: currentChatId || ''})").toBe(true)
    expect(page.includes('}, 10*60*1000);'), '}, 10*60*1000);').toBe(true)
  })
})

describe('proxy.rs: die vorhandenen Kommandos, auf die sich tauriProxyTransport stuetzt', () => {
  it('Namen, Fehlerform und Freigabe privater Adressen', () => {
    expect(proxy.includes('pub async fn proxy_localhost('), 'pub async fn proxy_localhost(').toBe(true)
    expect(proxy.includes('pub fn cancel_proxy_call('), 'pub fn cancel_proxy_call(').toBe(true)
    expect(proxy.includes('pub fn register_openai_host('), 'pub fn register_openai_host(').toBe(true)
    expect(proxy.includes('return Err(format!("HTTP {}: {}", status, text));'), 'return Err(format!("HTTP {}: {}", status, text));').toBe(true)
    expect(proxy.includes('Err("proxy_localhost: cancelled".to_string())'), 'Err("proxy_localhost: cancelled".to_string())').toBe(true)
    expect(proxy.includes('|| (o[0] == 192 && o[1] == 168)'), '|| (o[0] == 192 && o[1] == 168)').toBe(true)
    expect(proxy.includes('if !is_registerable_lan_host(&h) && !is_registerable_public_host(&h) {'), 'if !is_registerable_lan_host(&h) && !is_registerable_public_host(&h) {').toBe(true)
  })

  it('die Luecke besteht noch: proxy_localhost gibt nur Text zurueck, keine Kopfzeilen', () => {
    expect(/pub async fn proxy_localhost\([\s\S]*?\) -> Result<String, String> \{/.test(proxy), String(/pub async fn proxy_localhost\([\s\S]*?\) -> Result<String, String> \{/)).toBe(true)
  })
})
