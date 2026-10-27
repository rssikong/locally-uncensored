/**
 * Discord 28.09.2026 (Windows 11, Ollama mit Qwen und DeepSeek): "I
 * still can't get my models to access the files", jede Agent-Berechtigung auf
 * Auto. Nachgestellt am installierten 3.0.3 auf der Windows-Testmaschine: im normalen Chat fuehrt
 * "Read the file C:\Windows\win.ini and tell me its first line." zu keinem
 * einzigen Werkzeugaufruf. Das ist Absicht, Chat Tools haben kein file_read
 * (`CHAT_TOOLS` in chat-tool-intent.ts: Web, Datei SCHREIBEN als Anhang, Bild,
 * Video). Das Modell antwortete "I cannot access or read files on your local
 * system", und nichts in der App sagte, dass genau das der Agent kann.
 *
 * Erkannt wird hier die Bitte, eine Datei oder einen Ordner auf DIESEM Rechner
 * zu lesen, damit der Chat den Weg zum Agent zeigt. Entschieden wird nichts,
 * gesetzt wird nur eine Zeile ueber dem Verlauf. Deshalb lieber eine Bitte
 * verpassen als eine Zeile zu viel: es braucht immer ein Leseverb, dazu einen
 * Pfad auf diesem Rechner oder "meine Dateien" und Verwandte. Ein Pfad allein
 * reicht nicht, denn ein eingefuegter Stacktrace ist voller Pfade und bittet um
 * nichts. "Dokumente" zaehlt nicht, das sind in dieser App oft die ueber Docs
 * angehaengten, und die liest der Chat sehr wohl. Und "mein Rechner" allein
 * auch nicht: "why does my computer see only 8 GB" fragt nach Hardware.
 */
import { entumlauten } from './chat-tool-intent'
import { platformText } from './platform-text'

// Adressen im Netz vorher heraus, damit "/home/" in einer URL kein Pfad wird.
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi

// Laufwerk (C:\, D:/), UNC-Freigabe (\\server\), Heimordner (~/) und die
// ueblichen Wurzeln unter Linux, jeweils am Wortanfang.
const LOCAL_PATH_RE = /(?:^|[\s"'`(<[])(?:[a-z]:[\\/]|\\\\[\w.$-]+\\|~[\\/]|\/(?:home|users|mnt|media|tmp|etc|var|opt|srv|root)\/)/i

const READ_VERB_RE = /\b(?:read|open|access|view|see|look\s+(?:at|in|into|through)|check|scan|browse|analy[sz]e|summari[sz]e|go\s+through|search|find|list|load|lies|lese|lesen|oeffne|oeffnen|zugreifen|zugriff|durchsuche|durchsuchen|schau|anschauen|analysiere|analysieren)\b/i

// Regex-Literale und nicht String.raw: ein Zeichenkettenliteral mit deutschen
// Woertern haelt keine-deutschen-saetze-in-der-oberflaeche.test.ts fuer
// Oberflaechentext.
const MY_FILES_RE = new RegExp([
  /\b(?:my|local)\s+(?:own\s+)?(?:files?|(?:documents\s+|downloads\s+)?folders?|director(?:y|ies)|downloads)\b/.source,
  /\bfiles?\s+(?:on|in|from)\s+(?:my|this)\s+(?:pc|computer|laptop|machine|drive|disk|desktop|system|folder)\b/.source,
  /\b(?:meine[nmrs]?|lokale[nmrs]?)\s+(?:dateien|datei|ordner|downloads)\b/.source,
  /\bdateien\s+(?:auf|in|von)\s+(?:meinem|diesem)\s+(?:pc|rechner|laptop|computer|ordner|desktop)\b/.source,
].join('|'), 'i')

/** Bittet diese Nachricht darum, eine Datei oder einen Ordner auf diesem Rechner zu lesen? */
export function asksForLocalFiles(message: string): boolean {
  const t = entumlauten((message || '').toLowerCase()).replace(URL_RE, ' ')
  if (!READ_VERB_RE.test(t)) return false
  return LOCAL_PATH_RE.test(t) || MY_FILES_RE.test(t)
}

/** Die Zeile ueber dem Verlauf. Nennt die Knoepfe so, wie sie heissen. */
export const LOCAL_FILES_NOTICE = platformText('localFilesNotice')
