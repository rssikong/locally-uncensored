// Tippwege: wie ein Kunde von der Reiterleiste aus zu einer Seite oder einem
// Blatt kommt, nur mit echten Touches. Von Hand gepflegt, geprueft im
// Trockenlauf (jeder Selektor hier muss in tabelle.json oder einem
// Schnappschuss vorkommen, und in der Vorschau wird jeder Weg einmal gegangen).
//
// Form: [reiter, ...schritte]. Ein Schritt ist eine testid oder eine Liste von
// testids, von denen die erste sichtbare getippt wird (Leerzustand und
// gefuellter Zustand haben oft zwei Knoepfe fuer dasselbe).
//
// Eine Seite ohne Eintrag ist ohne Testhaken nicht herstellbar (sie braucht
// Daten: eine Nachricht, eine Datei, eine Kopplung, eine Anmeldung). Der Grund
// steht dann in OHNE_WEG.

// Erst zurueck auf "On this phone": Der Umschalter der Chatliste merkt sich seine Stellung.
// Wahlfrei ({ fallsDa }): Ein Paket ohne Remote (App Store) hat keinen Umschalter, dort ist die Liste immer
// die des Handys. Mit dem festen Schritt meldeten sweep.mjs und storeworte.mjs am App-Store-Paket sechs
// Chat-Routen als "nicht herstellbar" (Gegenpruefung grosses iPhone, H1). Ein Paket MIT Remote, dem der
// Umschalter fehlt, faellt weiter auf: Die Wege nach /remote/* tippen `m-chats-segment-remote` fest.
const HANDY = { fallsDa: 'm-chats-segment-phone' }

// Nur fuer /models/:id: nach dem Leerzustand von "Installed" steht der Katalog da und seine erste Karte wird
// getippt. War schon eine installierte Karte getippt, zeigt die Detailseite keine Karte und der Schritt entfaellt.
const KARTE_FALLS_KATALOG = { fallsDa: 'm-models-item-open' }

// Ein Schritt ist eine Kennung, eine Liste von Kennungen (die erste sichtbare wird getippt) oder { fallsDa: kennung }
// (wird getippt, wenn sie zu sehen ist, sonst uebersprungen).
export const istWahlfrei = (schritt) => !!schritt && typeof schritt === 'object' && !Array.isArray(schritt) && typeof schritt.fallsDa === 'string'
// Ein bewusster Schritt ({ bewusst: kennung, grund }): Die Kennung traegt eine Risikomarke (lib/sperre.mjs), und
// die Seite dahinter ist anders nicht zu erreichen. Der Weg tippt sie trotzdem, mit dem Grund, der hier steht,
// so wie ein Fluss dafuer tapBewusst nimmt. Ohne diese Form ist ein gesperrter Knopf in einem Weg ein Fehler
// des Trockenlaufs (wegSperrFehler), mit ihr auf einem Knopf ohne Sperre auch.
export const istBewusst = (schritt) => !!schritt && typeof schritt === 'object' && !Array.isArray(schritt) && typeof schritt.bewusst === 'string'
export const kennungenVon = (schritt) => (istWahlfrei(schritt) ? [schritt.fallsDa] : istBewusst(schritt) ? [schritt.bewusst] : [schritt].flat())

// Die Regel fuer gesperrte Knoepfe in Tippwegen, rein: sperreVon(kennung) nennt den Grund der Sperre oder null.
//   gesperrt und nicht bewusst          Fehler: Der Weg wuerde blind auf einen Knopf mit Risikomarke tippen
//   bewusst ohne Grund                  Fehler
//   bewusst, aber die Kennung ist frei  Fehler: Die Form ist kein Freibrief, sie gehoert nur an einen gesperrten Knopf
export function wegSperrFehler(wege, sperreVon) {
  const fehler = []
  for (const [ziel, weg] of Object.entries(wege)) {
    for (const schritt of weg.slice(1)) {
      for (const id of kennungenVon(schritt)) {
        const g = sperreVon(id)
        if (istBewusst(schritt)) {
          if (typeof schritt.grund !== 'string' || schritt.grund.trim().length < 20) fehler.push(`tabelle/wege.mjs: Weg nach ${ziel} tippt "${id}" bewusst, nennt aber keinen Grund`)
          if (!g) fehler.push(`tabelle/wege.mjs: Weg nach ${ziel} nennt "${id}" bewusst, die Kennung ist aber nicht gesperrt`)
        } else if (g) {
          fehler.push(`tabelle/wege.mjs: Weg nach ${ziel} tippt "${id}", das gesperrt ist (${g})`)
        }
      }
    }
  }
  return fehler
}
export const NEUER_CHAT = ['m-chats-new', 'm-chats-empty-new']
// Die vier Unterseiten des Chats haengen am Menue bzw. an den Optionen eines Chats MIT Verlauf:
// In einem neuen Chat sagt das Menue nur "This chat has no messages yet." und hat keine Zeile
// (gesehen am iPhone 17 Pro Max, 09.10.2026). Der Weg nimmt deshalb den obersten Chat der Liste.
// Voraussetzung wie beim Sweep: Der Kundenfluss ist gelaufen, es gibt einen Chat mit einer Antwort.
const CHAT_MIT_VERLAUF = 'm-chats-item'

export const WEGE = {
  // ---- Chat ----
  '/chats': ['chat', HANDY],
  '/chat/:id': ['chat', HANDY, NEUER_CHAT],
  '/chat/:id/compare': ['chat', HANDY, CHAT_MIT_VERLAUF, 'm-chat-menu', 'm-chat-menu-compare'],
  '/chat/:id/tasks': ['chat', HANDY, CHAT_MIT_VERLAUF, 'm-chat-menu', 'm-chat-menu-tasks'],
  '/chat/:id/documents': ['chat', HANDY, CHAT_MIT_VERLAUF, 'm-chat-menu', 'm-chat-menu-documents'],
  '/chat/:id/group': ['chat', HANDY, CHAT_MIT_VERLAUF, 'm-chat-options', 'm-options-group'],
  // Die Seitenvorschau haengt am Knopf "Preview" eines HTML-Blocks in einer Antwort. Kein Kundenfluss erzeugt
  // sicher eine solche Antwort, deshalb legt der Testhaken vorher einen Chat mit einem HTML-Block ab
  // (VORBEREITUNG). Der Weg selbst bleibt getippt. Ohne Haken geht er nur, wenn der oberste Chat einen
  // HTML-Block hat, sonst meldet der Rahmen die Seite als nicht herstellbar (Nachabnahme Android 8 GB).
  '/chat/:id/preview/:blockId': ['chat', HANDY, CHAT_MIT_VERLAUF, 'm-chat-code-preview'],
  // ---- Remote ----
  '/remote/connect': ['chat', 'm-chats-segment-remote', 'm-remote-enter'],
  // Der Knopf traegt data-m-risk="sensor": Die Seite dahinter ist der Sucher fuer den QR-Code der Kopplung.
  // Sie hat keinen anderen Eingang, deshalb steht der Tipp hier als bewusster Schritt mit Grund.
  '/remote/scan': ['chat', 'm-chats-segment-remote', 'm-remote-enter', { bewusst: 'm-remote-connect-scan', grund: 'einziger Eingang der Seite /remote/scan: Der Tipp oeffnet nur den Sucher fuer den QR-Code, es wird nichts aufgenommen, gespeichert oder gesendet' }],
  '/remote/help': ['chat', 'm-chats-segment-remote', 'm-remote-help'],
  // ---- Create ----
  '/create': ['create'],
  '/create/showcase': ['create', 'm-create-gate-showcase'],
  // ---- Models ----
  '/models': ['models'],
  '/models/downloads': ['models', 'm-models-downloads'],
  // Zuerst die Liste "Installed": Sie braucht kein Netz und kennt weder Suchtext noch Filter. Der alte Weg
  // tippte die erste Karte des Katalogs. Steht dort noch ein Suchtext oder ein Filter von der Pruefung davor,
  // oder laedt der Katalog laenger als die Wartezeit, gibt es keine Karte (zweite Gegenpruefung Android 8 GB:
  // storeworte.mjs meldete die Seite am Play-Paket als nicht herstellbar). Ist nichts installiert, fuehrt der
  // Knopf des Leerzustands in den Katalog, und der letzte Schritt tippt dort die erste Karte.
  '/models/:id': ['models', 'm-models-segment-installed', ['m-models-item-open', 'm-models-empty-getnew'], KARTE_FALLS_KATALOG],
  // ---- Settings ----
  '/settings': ['settings'],
  '/settings/account': ['settings', 'm-settings-account'],
  '/settings/appearance': ['settings', 'm-settings-theme'],
  '/settings/chat': ['settings', 'm-settings-chat'],
  '/settings/personas': ['settings', 'm-settings-personas'],
  '/settings/personas/:id': ['settings', 'm-settings-personas', 'm-personas-edit-assistant'],
  '/settings/memory': ['settings', 'm-settings-memory'],
  '/settings/voice': ['settings', 'm-settings-voice'],
  '/settings/agent': ['settings', 'm-settings-agent'],
  '/settings/search': ['settings', 'm-settings-search'],
  '/settings/workflows': ['settings', 'm-settings-workflows'],
  '/settings/engine': ['settings', 'm-settings-engine'],
  '/settings/engine/advanced': ['settings', 'm-settings-engine', 'm-settings-engine-advanced'],
  '/settings/providers': ['settings', 'm-settings-providers'],
  '/settings/remote': ['settings', 'm-settings-remote'],
  '/settings/storage': ['settings', 'm-settings-storage'],
  '/settings/data': ['settings', 'm-settings-data'],
  '/settings/data/import': ['settings', 'm-settings-data', 'm-settings-data-import'],
  '/settings/privacy': ['settings', 'm-settings-privacy'],
  '/settings/content-policy': ['settings', 'm-settings-content-policy'],
  '/settings/troubleshooting': ['settings', 'm-settings-troubleshooting'],
  '/settings/about': ['settings', 'm-settings-about'],
  '/whats-new': ['settings', 'm-settings-about', 'm-settings-about-whats-new'],
  '/cloud': ['settings', 'm-settings-account', 'm-account-what-is-cloud'],
}

export const BLATT_WEGE = {
  model: ['chat', HANDY, NEUER_CHAT, 'm-chat-model'],
  attach: ['chat', HANDY, NEUER_CHAT, 'm-chat-attach'],
  // Ein neuer Chat hat seit Runde 12 keinen Menueknopf mehr (F13): das Menue haengt an einem Chat mit Verlauf.
  'chat-menu': ['chat', HANDY, CHAT_MIT_VERLAUF, 'm-chat-menu'],
  'chat-options': ['chat', HANDY, NEUER_CHAT, 'm-chat-options'],
  'settings-licenses': ['settings', 'm-settings-about', 'm-settings-about-licenses'],
  // Runde 51: das Blatt der Tarife haengt am Hauptknopf der Seite LU Cloud, nur im offenen Paket (purchase links).
  // Ein Store-Paket hat das Blatt nicht; dort meldet der Rahmen es als nicht herstellbar, und das ist richtig.
  'settings-cloud-plans': ['settings', 'm-settings-account', 'm-account-what-is-cloud', 'm-cloud-get'],
}

// Was der Testhaken vor einem Tippweg ablegt: Route -> {aufgabe, schritt, braucht?, grund}. Die Aufgabe
// (lib/haken.mjs) antwortet mit {id}, der Schritt mit dieser Kennung tippt dann genau den Eintrag mit
// data-m-id=<id> statt des obersten. braucht: Ohne Haken geht der Weg nur, wenn diese Kennung nach dem
// Schritt davor zu sehen ist, sonst ist die Seite "nicht herstellbar". Ohne braucht geht der Weg ohne
// Haken wie jeder andere (oberster Chat).
// immer: Die Kennung haengt nicht am abgelegten Chat, sondern am Zustand der App. Dann wird auch mit Testhaken
// erst nachgesehen, ob sie da ist.
const CHAT_ABGELEGT = { aufgabe: 'chatMitSeite', schritt: CHAT_MIT_VERLAUF, grund: 'braucht einen Chat mit Verlauf (der Testhaken legt ihn ab, chatWithPage)' }
export const VORBEREITUNG = {
  '/chat/:id/compare': CHAT_ABGELEGT,
  // Mit einem Modell auf dem Handy hat das Chat-Menue keinen Eintrag "Background tasks" (ein Modell des Handys
  // startet keine Sub-Agenten, r6/reste Punkt 1). Dann ist die Seite nicht herstellbar, mit diesem Grund, statt
  // als "Fehler beim Oeffnen" in drei Pruefungen zu stehen (Nachpruefung Android 8 GB, H7). immer: auch mit Testhaken.
  '/chat/:id/tasks': { ...CHAT_ABGELEGT, braucht: 'm-chat-menu-tasks', immer: true, grund: 'braucht ein Cloud-Modell: Mit einem Modell auf dem Handy hat das Chat-Menue keinen Eintrag "Background tasks"' },
  '/chat/:id/documents': CHAT_ABGELEGT,
  '/chat/:id/group': CHAT_ABGELEGT,
  // suche: auch mit Testhaken wird nachgesehen, und ohne den abgelegten Chat (oder ohne Haken) werden bis zu acht
  // Chats der Liste geoeffnet, bis einer einen HTML-Block hat (Pruefung iOS Paket 17, F-R11).
  '/chat/:id/preview/:blockId': { ...CHAT_ABGELEGT, braucht: 'm-chat-code-preview', suche: 8, grund: 'braucht eine Antwort mit HTML-Block (der Testhaken legt sie ab, chatWithPage)' },
}

// Warum eine Seite oder ein Blatt keinen Tippweg hat.
export const OHNE_WEG = {
  '/welcome': 'nur auf frischer Installation, der Kundenfluss geht den Weg',
  '/setup/model': 'nur auf frischer Installation, der Kundenfluss geht den Weg',
  '/setup/documents': 'nur auf frischer Installation, der Kundenfluss geht den Weg',
  '/setup/done': 'nur auf frischer Installation, der Kundenfluss geht den Weg',
  '/chat/:id/file/:fileId': 'braucht einen Anhang im Chat',
  '/chat/:id/message/:messageId/edit': 'braucht eine Antwort im Chat',
  '/chat/:id/message/:messageId/text': 'braucht eine Nachricht im Chat',
  '/remote/chat/:id': 'braucht eine Kopplung mit einem Desktop',
  '/create/gallery': 'braucht eine angemeldete Sitzung',
  '/create/item/:id': 'braucht ein erzeugtes Ergebnis',
  '/create/mask': 'braucht ein Quellbild',
  '/create/characters': 'braucht eine angemeldete Sitzung',
  '/create/characters/new': 'braucht eine angemeldete Sitzung',
  '/create/presets': 'braucht eine angemeldete Sitzung',
  '/create/batch': 'braucht eine angemeldete Sitzung',
  '/create/styles': 'braucht eine angemeldete Sitzung',
  '/create/presets/:id': 'braucht eine angemeldete Sitzung',
  '/models/benchmark': 'braucht ein installiertes Modell',
  '/settings/providers/:id': 'der Kennwert des Anbieters steht erst zur Laufzeit fest',
  '/settings/memory/:id': 'braucht einen Memory-Eintrag',
  '/settings/workflows/:id': 'braucht einen Workflow',
  '/settings/workflows/:id/step/:stepId': 'braucht einen Workflow mit einem Schritt',
  '/create/gallery/pick/:purpose': 'braucht eine angemeldete Sitzung',
  'remote-attach': 'braucht eine Kopplung mit einem Desktop',
  'settings-forgot-password': 'braucht die Anmeldemaske einer abgemeldeten Sitzung, der Kundenfluss geht bis zur Maske',
  'settings-new-password': 'erscheint nur ueber den Link einer Reset-Mail',
  'settings-add-credits': 'nur in einem Paket mit dem Schalter purchase in-app und der Adresse, die gutschreibt; kein Preset ist so eines',
  message: 'braucht eine Nachricht im Chat',
  approval: 'erscheint nur, wenn der Agent um Erlaubnis fragt',
  tools: 'braucht eine angemeldete Sitzung',
  'create-model': 'braucht eine angemeldete Sitzung',
  'run-settings': 'braucht eine angemeldete Sitzung',
  source: 'braucht eine angemeldete Sitzung',
  result: 'braucht ein erzeugtes Ergebnis',
  'create-enhance': 'braucht ein erzeugtes Video',
  'create-preset': 'braucht eine angemeldete Sitzung',
  'create-character': 'braucht einen Charakter',
  credits: 'erscheint nur bei leerem Guthaben (Fehlerfall 6)',
  session: 'erscheint nur bei abgelaufener Sitzung (Fehlerfall 7)',
  price: 'braucht ein gewaehltes Cloud-Modell',
  'link-offer': 'erscheint nur bei einem Kauf-Link',
  report: 'braucht eine KI-Antwort (Kundenfluss, Schritt Melden)',
  'ai-consent': 'erscheint vor dem ersten Senden an LU Cloud',
  'agent-group-persona': 'braucht einen Gruppen-Chat',
  'agent-memory-conflict': 'braucht einen Abgleich mit Konflikt',
  'agent-memory-export': 'braucht einen Memory-Eintrag',
  'agent-add-step': 'braucht einen Workflow',
  'chat-voice-gate': 'erscheint beim Diktat ohne Stimme auf dem Handy',
  'chat-link': 'braucht eine Antwort mit Link',
  'remote-model': 'braucht eine Kopplung mit einem Desktop',
  'remote-options': 'braucht eine Kopplung mit einem Desktop',
  'remote-message': 'braucht eine Kopplung mit einem Desktop',
  'remote-chat-menu': 'braucht eine Kopplung mit einem Desktop',
  'remote-connection': 'braucht eine Kopplung mit einem Desktop',
  'create-computer': 'braucht eine Kopplung mit einem Desktop (Quelle "My computer" in Create, Runde 52 bis 55)',
  'settings-delete-account': 'braucht eine angemeldete Sitzung (Kundenfluss, Schritt Konto loeschen)',
}

// Echte Kennwerte fuer Seiten und Blaetter, die einen Eintrag brauchen: t ist die Antwort des Testhakens auf
// "daten" (lib/haken.mjs, testData). Die Funktion gibt die Parameter der Route bzw. die Angaben des Blatts zurueck,
// oder null, wenn der Eintrag fehlt (t.missing nennt den Grund). Dann bleibt es beim Tippweg oder beim Beispielwert,
// und der Bericht zaehlt die Seite als Ersatzseite.
// Gegenpruefung Android 4 GB, Teil 2: Rund 25 Seiten und Blaetter wurden mit erfundenen Kennwerten geoeffnet und
// zeigten nur "This memory is gone.", "This workflow is gone.", "This result is no longer available".
// Nicht dabei, weil kein Skript sie ehrlich herstellt: alles hinter der Anmeldung (Create ausser der Ergebnisansicht),
// die Kopplung mit einem Desktop (/remote/chat/:id und ihre Blaetter), ein Anhang im Chat (/chat/:id/file/:fileId).
const alle = (o) => (Object.values(o).every((v) => typeof v === 'string' && v) ? o : null)
export const DATEN_PARAMS = {
  '/chat/:id/message/:messageId/edit': (t) => alle({ id: t.chatId, messageId: t.messageId }),
  '/chat/:id/message/:messageId/text': (t) => alle({ id: t.chatId, messageId: t.messageId }),
  '/chat/:id/group': (t) => alle({ id: t.groupChatId }),
  '/settings/memory/:id': (t) => alle({ id: t.memoryId }),
  '/settings/workflows/:id': (t) => alle({ id: t.workflowId }),
  '/settings/workflows/:id/step/:stepId': (t) => alle({ id: t.workflowId, stepId: t.stepId }),
  '/create/item/:id': (t) => alle({ id: t.createItemId }),
}
export const BLATT_DATEN = {
  message: (t) => alle({ chatId: t.chatId, messageId: t.messageId }),
  'agent-add-step': (t) => alle({ workflowId: t.workflowId }),
  'agent-group-persona': (t) => alle({ chatId: t.groupChatId, model: t.groupModel }),
  result: (t) => alle({ id: t.createItemId }),
}

// Beispielwerte fuer Parameter-Routen, wenn der Testhaken sie oeffnet.
export const BEISPIEL_PARAMS = {
  '/chat/:id': { id: 'new' },
}

export function alleSchritte() {
  const aus = new Set()
  for (const weg of [...Object.values(WEGE), ...Object.values(BLATT_WEGE)]) for (const s of weg.slice(1)) for (const id of kennungenVon(s)) aus.add(id)
  return [...aus]
}
