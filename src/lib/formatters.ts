/**
 * Eine Zahl mit Tausendertrennern fuer die Oberflaeche.
 *
 * Mit fester Sprache, nicht mit der des Betriebssystems. Persona P2 hat am
 * 04.09.2026 auf der deutschen Windows-Box gemessen, was `toLocaleString()`
 * ohne Sprache anrichtet: die Statuszeile der Engine lautete
 * "Engine running · Phi-4-mini-instruct-Q4_K_M · ctx 8.192". Gemeint sind
 * 8192 Token, in einer englischen Oberflaeche liest sich "8.192" als eine
 * Zahl kleiner als neun. Dieselbe Zahl stand zwei Zeilen tiefer im
 * Eingabefeld richtig als 8192. Auch "9.766 downloads" in den
 * CivitAI-Treffern war betroffen.
 *
 * Die Oberflaeche dieser Anwendung ist Englisch, also sind es ihre Zahlen
 * auch. Hausregel: keine lokalisierten Systemtexte durchreichen.
 */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Eine Byte-Zahl fuer die Oberflaeche. Die EINE Stelle, die das tut.
 *
 * Bauer Q hat am 11.09.2026 auf dem Mac gemessen, was zwei Rechnungen
 * nebeneinander anrichten: fuer dieselbe Datei, NSFW-gen v2 mit 8.577 Mrd.
 * Bytes, stand in der Downloads-Leiste "8.0 GB" und auf der Katalogkarte des
 * MLX-Bildmodells "8.6 GB". Gleiche Einheit im Text, zwei Zahlen, und keine
 * Chance zu erkennen, dass beide dieselbe Datei meinen.
 *
 * Es gewinnt die 1024er-Rechnung, und zwar nicht aus Geschmack: sie steht im
 * Produkt schon ueberall geschrieben, und jede andere Wahl haette
 * veroeffentlichte Zahlen verschoben.
 *   `api/discover.ts`      "One gibibyte, the unit the catalog's `sizeGB` and
 *                           every size message use"
 *   `api/model-bundles.ts` "sizes in GiB from the actual response", am
 *                           18.07.2026 gegen HuggingFace gemessen
 *   `lib/constants.ts`     das Startmodell steht mit "4.4 GiB" auf der Karte,
 *                           bei 4.683.074.240 Bytes
 * Der Ausreisser ist der MLX-Bildkatalog in `src-tauri/src/commands/mlx.rs`,
 * der seine Groessen in Dezimal-GB fuehrt; `api/mlx-image.ts` rechnet sie
 * deshalb beim Lesen in diese eine Regel um.
 *
 * Die Namen bleiben KB, MB, GB. Sie sind streng genommen die Dezimalnamen,
 * aber jedes Betriebssystem schreibt sie an dieselbe 1024er-Rechnung, und der
 * Rest dieser Oberflaeche tut es auch. Eine Leiste mit "GiB" neben lauter
 * Katalogkarten mit "GB" haette genau den Fehler erzeugt, den
 * `formatContextWindow` weiter unten schon einmal aufgeraeumt hat: wer den
 * Unterschied liest, sucht einen, den es nicht gibt.
 *
 * Wer eine zweite Byte-Rechnung baut, faellt im Waechter auf
 * (`__tests__/eine-regel-fuer-bytes.test.ts`).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/**
 * Eine Groesse, die in Dezimal-GB angegeben ist, in Bytes.
 *
 * Genau ein Zulieferer zaehlt so: der MLX-Katalog in
 * `src-tauri/src/commands/mlx.rs` und `video.rs`. Das ist keine Vermutung, es
 * steht in seinem eigenen Code: beide rechnen ihre Groesse mit
 * `size_gb as f64 * 1e9` in Bytes um, `mlx.rs` beim Pull und `video.rs` bei der
 * Platzpruefung. Bauer Q hat es am Stueck gemessen: Eintrag 8.6, Datei
 * 8.577 Mrd. Bytes.
 *
 * Damit endet die zweite Zaehlweise am Rand: was danach in der Oberflaeche
 * landet, sind Bytes, und Bytes kennen nur `formatBytes`. Aus 8.6 wird so
 * "8.0 GB", dieselbe Zeichenkette, die die Downloads-Leiste waehrend des
 * Ladens zeigt.
 */
export function siGbToBytes(gb: number): number {
  return Math.round(gb * 1_000_000_000)
}

export function formatEta(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  // Whole minutes first, hours and minutes from that. Rounding the minutes
  // apart from the hours wrote "11 h 60 min" for 11 h 59.5 min, and "60 min"
  // for the last half minute below an hour.
  const minutes = Math.round(s / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

// #162: the bracket next to the Rebuilding spinner. Empty until the backend
// has announced a total, so a plain spinner never grows a "(0 B of 0 B)".
export function downloadSuffix(p: { progress: number; total: number; speed: number }): string {
  if (!p.total) return ''
  const parts = [`${formatBytes(p.progress)} of ${formatBytes(p.total)}`]
  if (p.speed > 0) {
    parts.push(`${formatBytes(p.speed)}/s`)
    parts.push(`~${formatEta(Math.max(0, p.total - p.progress) / p.speed)} left`)
  }
  return ` (${parts.join(', ')})`
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}

/**
 * Ein Kontextfenster, in EINER Schreibweise.
 *
 * Gegenprobe G2, 04.09.2026: derselbe Wert 8192 stand an fuenf Stellen in vier
 * Schreibweisen da, zwei davon auf demselben Bildschirm. Im Chat war es
 * gleichzeitig `1.3k/8.2k` auf dem Knopf und `Auto · 8K` in der Klapplade
 * darunter, also 8192 geteilt durch 1000 neben 8192 geteilt durch 1024. "Wer
 * den Unterschied las, suchte einen, den es nicht gibt", stand schon in
 * ContextDropdown, aber die beiden Rechnungen standen weiter nebeneinander.
 *
 * Es gewinnt die Kibi-Rechnung, weil die Stufen des Reglers echte
 * Zweierpotenzen sind: 4096, 8192, 16384 heissen 4K, 8K, 16K und nichts
 * anderes. Ein krummer Zwischenwert, etwa der Verbrauch, bekommt eine
 * Nachkommastelle, damit er nicht auf die naechste Stufe gerundet aussieht.
 */
export function formatContextWindow(n: number): string {
  if (n <= 0) return 'Auto'
  if (n % 1024 === 0) return `${n / 1024}K`
  if (n < 1024) return String(n)
  return `${(n / 1024).toFixed(1)}K`
}

/**
 * "1 files" ist kein Satz.
 *
 * Gegenprobe G2, 04.09.2026: die Bildmodell-Kacheln auf der Models-Seite
 * zeigten "1 files", auch bei genau einer Datei, und das X ueber einem
 * einzelnen Download hiess "Cancel all". Beides sind Stellen, an denen die
 * Anzahl VOR dem Wort steht und niemand hingesehen hat.
 */
export function countLabel(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`
}
