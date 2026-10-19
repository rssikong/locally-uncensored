/** Der Anfang fuer den Create-Weg: dort hat LU gerade selbst installiert. */
export const COMFY_INSTALLED_BUT_DEAD = 'Installed ComfyUI but it did not come up.'

/** Der Anfang fuer den Startknopf in den Einstellungen.
 *
 *  P3: dort hat niemand etwas installiert, dort wurde Start gedrueckt, und der
 *  Satz von der frischen Installation stand trotzdem darueber. Solange die
 *  Meldung nur alle sechs Sekunden einmal ueberhaupt erschien, ist das kaum
 *  jemandem untergekommen; ein Beobachter, der jeden spaeten Absturz meldet,
 *  wuerde die falsche Zeile zuverlaessig zeigen. */
export const COMFY_START_FAILED = 'ComfyUI did not come up.'

/** Turn the ComfyUI output tail into an error a person can act on. The last
 *  lines of a startup crash name the real problem (a torch import error, a
 *  missing DLL, an OOM); without them the message was a dead end (GH #98).
 *  `opening` says which of the two ways in this was, `advice` is the sentence
 *  under the output, see comfyCrashAdvice. */
export function comfyStartupError(opening: string, lines?: string[], advice?: string): string {
  const tail = (lines ?? []).map((l) => l.trim()).filter(Boolean).slice(-6)
  const rat = (advice ?? '').trim()
  const msg = tail.length ? `${opening} Its last output:\n${tail.join('\n')}` : `${opening} Check Settings → AI Backends.`
  return rat ? `${msg}\n\n${rat}` : msg
}

/** Der bisherige allgemeine Satz. Er gilt weiter fuer jeden Absturz, den ein
 *  Neubau der Umgebung wirklich beheben kann. */
export const REPAIR_ADVICE =
  'The Python environment looks broken. Repair environment below rebuilds it in place; models, outputs and custom nodes are left alone.'

/** Der Satz unter der Ausgabe, aus einer Stelle statt aus zweien.
 *
 *  Ticket 007 (a user, 01.09. bis 02.09.): sein torch starb an einem
 *  WinError 1114, und die Oberflaeche haengte trotzdem den allgemeinen Satz
 *  an. Der Einordner des Installers kannte diesen Fehler die ganze Zeit, also
 *  gewinnt sein Hinweis, sobald Rust einen mitliefert. Bleibt keiner uebrig,
 *  bleibt es beim alten Satz, und den gibt es nur noch, wenn Rust die
 *  Umgebung als reparierbar meldet. */
export function comfyCrashAdvice(out?: { hint?: string; envBroken?: boolean } | null): string {
  const hint = (out?.hint ?? '').trim()
  if (hint) return hint
  return out?.envBroken ? REPAIR_ADVICE : ''
}

/** Die Meldung eines Starts, der schon vorbei war, bevor `start_comfyui`
 *  zurueckkam, mit dem Satz darunter, den der Einordner dazu hat.
 *
 *  P3, 7.2: ein umbenanntes c10.dll toetet torch beim ersten Import, also weit
 *  innerhalb der zwei Sekunden, die Rust zuschaut. Dieser Weg wirft, und ein
 *  Wurf plant keinen Beobachter, also kam der Hinweis auf die Visual-C++-
 *  Laufzeit nie an, obwohl der Einordner ihn die ganze Zeit hatte. Wer eine
 *  Sekunde spaeter starb, bekam ihn.
 *
 *  Kein zweiter Einordner und kein zweiter Text: `message` ist die Meldung, die
 *  Rust schon gebaut hat (Interpreterpfad, Exit-Code, die letzten acht Zeilen),
 *  und darunter kommt genau der Satz, den `comfyCrashAdvice` fuer beide
 *  Oberflaechen entscheidet. Steht er schon in der Meldung, bleibt es bei
 *  einem. */
export function comfyStartThrowText(
  message: string,
  out?: { hint?: string; envBroken?: boolean } | null,
): string {
  const base = message.trim()
  const advice = comfyCrashAdvice(out)
  if (!advice || base.includes(advice)) return base
  return `${base}\n\n${advice}`
}

/** What ComfyUI itself printed about a node pack it could not load.
 *
 *  ComfyUI writes two lines for such a pack at startup: "Cannot import
 *  <folder> module for custom nodes: <reason>", and further down, in its list
 *  of import times, "<n> seconds (IMPORT FAILED): <folder>". The first carries
 *  the reason, so it wins; the second is the fallback. Colour codes and the
 *  log prefix are dropped. Empty when ComfyUI said nothing about the pack. */
export function nodePackImportFailure(lines: string[] | undefined, packName: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = (lines ?? []).map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
  const about = plain.filter((l) => l.includes(packName))
  const reason = about.filter((l) => l.includes('Cannot import')).pop()
  if (reason) return reason.slice(reason.indexOf('Cannot import'))
  return about.filter((l) => l.includes('(IMPORT FAILED)')).pop() ?? ''
}

/** The error of a node pack that was installed and still did not register its
 *  node (the box, 03.10.2026, ComfyUI-RMBG). It used to send the user to "the
 *  ComfyUI console", which the shipped app does not have. It now carries the
 *  line ComfyUI printed, read from the same buffer the startup errors use. */
export function nodePackLoadError(packName: string, nodeClass: string, lines?: string[]): string {
  const failure = nodePackImportFailure(lines, packName)
  if (failure) {
    return `ComfyUI could not load ${packName}, so the ${nodeClass} node is missing. ComfyUI reported: ${failure}`
  }
  return `Installed ${packName} and restarted ComfyUI, but it still isn't listing the ${nodeClass} node, ` +
    'and ComfyUI printed no import error for it. Restart ComfyUI under Settings, AI Backends, then try again.'
}

/** Die Zeile "Device: ..." aus der Startausgabe von ComfyUI, leer wenn keine
 *  da ist.
 *
 *  3.0.7: Nach einem Wechsel des GPU-Modus wusste niemand, ob ComfyUI jetzt
 *  auf der Karte laeuft. ComfyUI sagt es selbst, in genau einer Zeile beim
 *  Start ("Device: cuda:0 ...", "Device: xpu:0 ...", "Device: cpu"), und die
 *  steht im Ringpuffer, den `comfyui_last_output` liefert. Die letzte gewinnt,
 *  weil der Puffer erst beim naechsten Start geleert wird. */
export function comfyDeviceLine(lines?: string[] | null): string {
  for (const raw of [...(lines ?? [])].reverse()) {
    const at = raw.indexOf('Device: ')
    if (at < 0) continue
    const line = raw.slice(at).trim()
    if (line.length > 'Device: '.length) return line
  }
  return ''
}
