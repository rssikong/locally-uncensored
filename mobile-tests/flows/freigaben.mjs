// Ausdrueckliche Freigaben fuer den Jeder-Knopf-Sweep.
//
// Der Sweep tippt keinen Knopf, den lib/sperre.mjs sperrt (data-m-risk="paid",
// "destructive", "leaves-app" oder "sensor", oder eine testid bzw. ein Name aus der Sperrliste). Hier
// steht, welche davon er trotzdem ausloesen darf, wie weit, und warum.
//
// modus:
//   'bis-rueckfrage'  Tippen, dann MUSS die genannte Rueckfrage (m-dialog-<name>) oder das
//                     genannte Blatt erscheinen. Der Sweep verlaesst sie ueber "Abbrechen"
//                     und bestaetigt nie. Erscheint nichts, ist das ein Befund: Der Knopf
//                     hat ohne Nachfrage gehandelt.
//   'tippen'          Tippen wie jeder andere Knopf. Nur fuer Elemente, die die Sperrliste
//                     wegen ihres Namens faengt, die aber weder kosten noch loeschen.
//   'mit-ruecknahme'  Tippen, und danach nimmt der Sweep die Wirkung wieder zurueck, auf dem Weg, den ein Kunde
//                     dafuer hat (flows/ruecknahmen.mjs, Eintrag `ruecknahme`). Vor dem Tipp liest der Sweep den
//                     Stand: Laesst es sich in diesem Paket nicht zuruecknehmen oder war es schon vor dem Sweep
//                     so, bleibt der Knopf gesperrt. Was sich nicht zuruecknehmen liess, steht unter "verstellt".
//   'bezahlt'         Tippen ueber den Kostenwaechter (ALLOW_PAID=1, Grenzen aus kosten.mjs).
//                     In dieser Liste steht davon keiner: Bezahltes laeuft einzeln in
//                     flows/kundenfluss.mjs, nie im Sweep.
//
// Jeder Eintrag braucht eine Begruendung. Ohne Eintrag bleibt der Knopf gesperrt
// und steht im Sweep-Ergebnis unter "einzelnTesten".

export const FREIGABEN = [
  // ---- zerstoerend, mit Rueckfrage ----
  { testid: 'm-chat-menu-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-delete-chat', grund: 'Chat loeschen fragt nach (ChatMenuSheet), Abbrechen laesst den Chat stehen' },
  { testid: 'm-chat-message-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-delete-message', grund: 'Nachricht loeschen fragt nach (MessageSheet)' },
  { testid: 'm-account-delete', modus: 'bis-rueckfrage', erwartet: 'm-sheet-settings-delete-account', grund: 'oeffnet nur das Blatt "Delete account". Der Knopf darin (m-account-delete-go-delete) bleibt gesperrt' },
  { testid: 'm-settings-data-all-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-delete-all-1', grund: 'erste von zwei Rueckfragen, Abbrechen behaelt alles' },
  { testid: 'm-memory-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-memory-delete', grund: 'Memory-Eintrag loeschen fragt nach' },
  { testid: 'm-persona-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-persona-delete', grund: 'Persona loeschen fragt nach' },
  { testid: 'm-documents-remove', modus: 'bis-rueckfrage', erwartet: 'm-dialog-document-remove', grund: 'Dokument entfernen fragt nach' },
  { testid: 'm-documents-remove-all', modus: 'bis-rueckfrage', erwartet: 'm-dialog-document-remove-all', grund: 'alle Dokumente entfernen fragt nach' },
  { testid: 'm-workflow-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-workflow-delete', grund: 'Workflow loeschen fragt nach' },
  { testid: 'm-models-detail-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-delete-model', grund: 'Modell loeschen fragt nach (G3)' },
  { testid: 'm-settings-storage-delete', modus: 'bis-rueckfrage', erwartet: 'm-dialog-delete-model', grund: 'Modell loeschen fragt nach (G3)' },
  { testid: 'm-settings-engine-reset', modus: 'bis-rueckfrage', erwartet: 'm-dialog-engine-reset', grund: 'Engine-Einstellungen zuruecksetzen fragt nach (G3)' },
  { testid: 'm-models-benchmark-clear', modus: 'bis-rueckfrage', erwartet: 'm-dialog-benchmark-clear', grund: 'Benchmark-Ergebnisse loeschen fragt nach (G3)' },
  // ---- bewusster Schritt mit Ruecknahme ----
  { testid: 'm-consent-agree', modus: 'mit-ruecknahme', ruecknahme: 'einwilligung', grund: 'erteilt die Einwilligung fuer LU Cloud. Der Sweep widerruft sie gleich danach in Settings, Privacy und tippt nur, wenn sie vorher nicht erteilt war' },
  // ---- vom Namen gesperrt, aber harmlos ----
  { testid: 'm-chat-model-download', modus: 'tippen', grund: 'fuehrt nur zum Reiter Models, startet keinen Download' },
  { testid: 'm-chat-install-model', modus: 'tippen', grund: 'fuehrt nur zum Reiter Models' },
  { testid: 'm-models-download-notice-open', modus: 'tippen', grund: 'oeffnet nur die Downloadliste' },
  { testid: 'm-settings-troubleshooting-run', modus: 'tippen', grund: 'laesst die drei lokalen Pruefungen noch einmal laufen, kostet nichts' },
  { testid: 'm-settings-voice-test-system', modus: 'tippen', grund: 'Stimme des Systems, kein Cloud-Aufruf' },
  { testid: 'm-settings-voice', modus: 'tippen', grund: 'Zeile "Voice" in den Einstellungen, oeffnet nur die Seite' },
  { muster: /^m-settings-voice-(read-aloud|auto|system|dictation)$/, modus: 'tippen', grund: 'Schalter auf der Seite Voice, loesen keinen Cloud-Aufruf aus' },
  { muster: /^m-settings-voice-pick-/, modus: 'tippen', grund: 'waehlt eine Stimme aus, spielt nichts ab' },
  { testid: 'm-settings-storage-wifi', modus: 'tippen', grund: 'Schalter "nur im WLAN laden"' },
  { testid: 'm-settings-privacy-counter', modus: 'tippen', grund: 'Schalter fuer den anonymen Zaehler' },
  { testid: 'm-chat-attach-documents', modus: 'tippen', grund: 'fuehrt zu den Dokumenten des Chats' },
  { testid: 'm-options-group', modus: 'tippen', grund: 'fuehrt zur Seite Gruppen-Chat' },
]

export function freigabeFuer(element, liste = FREIGABEN, route = null) {
  if (!element.testid) return null
  return liste.find((f) => (f.testid ? f.testid === element.testid : f.muster.test(element.testid)) && (!f.routen || !route || f.routen.includes(route))) ?? null
}
