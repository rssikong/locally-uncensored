/**
 * Transport des Remote-Clients ueber die Rust-Kommandos, die es in 3.0.5 schon
 * gibt: `register_openai_host`, `proxy_localhost`, `cancel_proxy_call`.
 *
 * Warum ueberhaupt Rust: der Desktop-Server sendet keine CORS-Kopfzeilen
 * (`CorsLayer::new()` in remote.rs), also scheitert jeder fetch aus der
 * WebView der App schon an der Vorabfrage, auch ueber den https-Tunnel. Im
 * WLAN kommt dazu, dass die WebView Klartext-http blockiert.
 *
 * Was dieser Weg kann und was nicht, steht in
 * `mobile-docs/REMOTE-PROTOKOLL.md`, Abschnitt "Was die Rust-Seite koennen
 * muss". Kurz:
 *   - Er erreicht private Adressen und oeffentliche Hostnamen, nachdem der
 *     Host einmal angemeldet wurde.
 *   - Er liefert Statuscodes ueber den Fehlertext "HTTP <status>: <text>".
 *   - Er verliert ALLE Antwort-Kopfzeilen. Damit kommt das verlaengerte Token
 *     nie an, und eine Sitzung endet hart 60 Minuten nach dem Koppeln.
 *   - Er liefert die Antwort am Stueck. Das kostet gegen 3.0.5 nichts, weil
 *     der Desktop die Antwort ohnehin am Stueck schickt.
 *
 * Belegt ist dieser Transport nur gegen ein nachgebildetes `invoke`, nicht auf
 * einem Geraet. Ob die Kommandos im Handy-Bau vorhanden sind, ist offen.
 */
import type { RemoteFetch } from './remoteClient'

export type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

export interface ProxyTransportOptions {
  invoke: TauriInvoke
  /** Frist je Aufruf in Millisekunden. Vorgabe: 660 s, wie der laengste Chat. */
  timeoutMs?: number
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost')
}

export function createProxyLocalhostFetch(options: ProxyTransportOptions): RemoteFetch {
  const { invoke } = options
  const registered = new Set<string>()

  return async (url, init = {}) => {
    const signal = init.signal
    if (signal?.aborted) throw abortError()

    const host = new URL(url).hostname
    if (!isLoopback(host) && !registered.has(host)) {
      // Die Freigabeliste des Proxys kennt nur Hosts, die ausdruecklich
      // angemeldet wurden. Ein abgelehnter Host ist ein Netzfehler.
      try {
        await invoke('register_openai_host', { host })
        registered.add(host)
      } catch (err) {
        throw new TypeError(`register_openai_host: ${String(err)}`)
      }
    }

    const callId = globalThis.crypto?.randomUUID?.() ?? `rc_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const onAbort = () => {
      void invoke('cancel_proxy_call', { callId }).catch(() => {})
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const text = (await invoke('proxy_localhost', {
        url,
        method: init.method ?? 'GET',
        body: init.body ?? null,
        timeoutMs: options.timeoutMs ?? 660_000,
        headers: init.headers ?? null,
        callId,
      })) as string
      return new Response(text, { status: 200 })
    } catch (err) {
      const msg = String(err)
      if (signal?.aborted || /proxy_localhost: cancelled/.test(msg)) throw abortError()
      // Rust meldet jeden Status ausser 2xx als Err("HTTP <status>: <text>").
      const m = /(?:^|:\s*)HTTP (\d{3}):\s?([\s\S]*)$/.exec(msg)
      const status = m ? Number(m[1]) : 0
      if (m && status >= 200 && status <= 599) {
        const noBody = status === 204 || status === 205 || status === 304
        return new Response(noBody ? null : (m[2] ?? ''), { status })
      }
      throw new TypeError(msg)
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
