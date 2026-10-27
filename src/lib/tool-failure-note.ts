// Was das Modell zu sehen bekommt, wenn ein Werkzeug NICHT gelaufen ist.
//
// Persona-Lauf vom 03.09.2026, `llama3.2:3b`, zwei Faelle derselben Sorte:
//
//   • `shell_execute` brach mit `task "status" needs a task_id` ab — der
//     Befehl lief nie. Der Assistent nannte trotzdem `10.15` als
//     Betriebssystemversion. Richtig waere `26.3.1` gewesen.
//   • `web_search` lieferte fuenf Trefferlisten ohne Antwort. Der Assistent
//     erfand einen Namen UND schob eine Wikipedia-Seite als Beleg unter, die
//     er nie geoeffnet hatte.
//
// Ihr Satz dazu: sie merkt es nur, wenn sie die Werkzeugkarte aufklappt und
// den Fehler selbst liest. Genau deshalb steht hier ein Satz mehr in der
// Historie: der Fehltext allein ("needs a task_id") sagt einem kleinen Modell
// nicht, dass es jetzt NICHT raten soll.
//
// Vorbild ist D#81: nach einer fehlgeschlagenen Bildgenerierung wurde die
// „liegt auf dem Schirm"-Notiz weggelassen, weil genau sie das Modell dazu
// brachte, ein Bild anzukuendigen, das es nie gab. Dasselbe Prinzip, andere
// Richtung.
//
// GRENZE, ehrlich: dass der Satz ANKOMMT, ist pruefbar und geprueft. Ob ein
// 3B-Modell daraufhin wirklich aufhoert zu erfinden, ist es nicht — das
// entscheidet das Modell.

/** Der Zusatz fuer einen Werkzeuglauf, der nicht geliefert hat. Leer, wenn alles gut ging. */
export function toolFailureNote(status: string): string {
  // 'rejected' hat schon einen eigenen, staerkeren Satz ("User rejected this
  // action") — ein zweiter davor waere nur Laerm.
  if (status !== 'failed' && status !== 'error' && status !== 'timeout') return ''
  return '\n\nThis tool did NOT run, so there is no output. Do not state or guess what it would have returned. Either call it again with corrected arguments, or tell the user plainly that this step failed.'
}

// ── Das Echo ────────────────────────────────────────────────────────────
//
// Ein kleines Modell gibt den Zusatz oben als seine Antwort aus, fast Wort
// fuer Wort (Gegenpruefung grosses iPhone, N11: Qwen3 1.7B nach einem
// Zeitlimit von web_fetch: "The tool execution timed out, so there is no
// output. Do not state or guess what it would have returned. Either call it
// again with corrected arguments, or tell the user plainly that this step
// failed."). Der Zusatz ist eine Anweisung der App an das Modell und keine
// Antwort an den Nutzer. Die zwei Anweisungssaetze erkennt man sicher: kein
// Mensch und kein Modell schreibt sie von sich aus. Der erste Satz wird nur
// mitgenommen, wenn er direkt davor steht und auf "so there is no output"
// endet, denn seinen Anfang formuliert das Modell um.
//
// Rein, und nur gerufen, wo eine Oberflaeche es will (die Handy-Shell). Der
// Zusatz selbst bleibt Zeichen fuer Zeichen, wie er war.

const ws = (sentence: string): string => sentence.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
const NO_GUESS = ws('Do not state or guess what it would have returned')
const CALL_AGAIN = ws('Either call it again with corrected arguments, or tell the user plainly that this step failed')
const NO_OUTPUT_LEAD = `(?:[^.!?\\n]{0,120},?\\s+so\\s+there\\s+is\\s+no\\s+output\\.?\\s*)?`
const FAILURE_ECHO = new RegExp(`["'\u201c]?${NO_OUTPUT_LEAD}(?:${NO_GUESS}\\.?\\s*(?:${CALL_AGAIN}\\.?)?|${CALL_AGAIN}\\.?)["'\u201d]?`, 'gi')

/**
 * Pure: an answer without a repeat of the note above. `echoed` says that one
 * was there, so a reader can say in its own words what happened when nothing
 * else is left of the answer.
 */
export function stripFailureNoteEcho(text: string): { text: string; echoed: boolean } {
  const source = text ?? ''
  FAILURE_ECHO.lastIndex = 0
  if (!FAILURE_ECHO.test(source)) return { text: source, echoed: false }
  FAILURE_ECHO.lastIndex = 0
  return { text: source.replace(FAILURE_ECHO, '').replace(/\n{3,}/g, '\n\n').trim(), echoed: true }
}
