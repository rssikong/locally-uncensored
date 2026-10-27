# LU Mobile: Design der Mobile-Shell

Stand: 08.10.2026. Gilt fuer Android und iOS, eine gemeinsame Shell unter `src/mobile/`.
Grundlage: `MOBILE-ZIEL.md`, `mobile-docs/INVENTUR-FUNKTIONEN.md` (173 Zeilen, die aufs Handy kommen), die Lektionen aus `mobile-docs/INVENTUR-UEBERNAHME.md` Abschnitt 4 und der Desktop-Look aus `src/index.css` und `src/components/*`.
Anklickbarer Prototyp: `mock/index.html`. Belege: `mock/shots/`.
UI-Sprache der App ist Englisch. Alle englischen Texte in diesem Dokument sind Vorschlaege im Wortlaut und enthalten keine Gedankenstriche.

Lesehilfe: Jeder Screen hat ein Kuerzel (A Onboarding, C Chat, R Remote, K Create, M Models, E Settings, G global). Jedes bedienbare Element hat eine Nummer wie `C2.7`. Diese Nummern sind das Knopf-Inventar fuer Punkt 2 der Abnahme.

## 1. Prinzipien

1. **Ein Daumen, eine Sache.** Jeder Screen hat genau eine Hauptaufgabe und hoechstens einen gefuellten Hauptknopf. Alles Seltene liegt eine Ebene tiefer in einem Blatt.
2. **Nichts haengt am Hover, nichts an einer versteckten Geste.** Jede Aktion ist ueber ein sichtbares Ziel erreichbar. Langes Druecken und Wischen sind nur Abkuerzungen fuer etwas, das auch einen Knopf hat.
3. **Blatt statt Dropdown, Seite statt Modal.** Auswahl und kurze Einstellungen kommen als Bottom Sheet. Alles mit Tastatur, Liste oder mehreren Schritten ist eine Vollbild-Seite im Zurueck-Stapel. Dialoge gibt es nur fuer Rueckfragen vor Zerstoerendem und fuer Fehler, die eine Entscheidung brauchen.
4. **Zurueck schliesst immer das Oberste.** Tastatur, Dialog, Blatt, Seite, Reiter, in dieser Reihenfolge. Jeder dieser Zustaende haelt einen Eintrag im Stapel. Die App schliesst sich nur von der Wurzel des Chat-Reiters.
5. **Die App sagt, wo gerechnet wird und was es kostet.** Lokal ist gruen und kostenlos, Cloud ist violett und nennt Guthaben, bevor etwas laeuft. Im Cloud-Modus wird nie ein Modell still vorgewaehlt.
6. **Jeder Fehler nennt Ursache, Folge und naechsten Schritt.** Drei kurze Saetze, ein Hauptknopf, ein Ausweg. Was der Nutzer getippt hat, bleibt im Feld.
7. **Ehrliche Rueckmeldung.** "Copied", "Saved", "Installed" erscheint erst nach dem bestaetigten Erfolg. Ein Knopf, der hier nicht arbeiten kann, wird nicht gezeigt.
8. **Dasselbe Programm.** Fast schwarze Leinwand, neutrale Grautoene, ein violetter Akzent, das LU-Monogramm, Inter und Space Grotesk, Zahlen in Mono, kurze ruhige Saetze. Keine Verlaeufe, keine Illustrationen, kein Glas.
9. **Schrift waechst, Raender nicht.** Schriftgroessen stehen in rem und folgen der Systemschrift bis 200 Prozent. Abstaende und Mindestziele stehen in px. Zeilen duerfen umbrechen und hoeher werden, nichts wird abgeschnitten.
10. **Keine Desktop-Reste.** Kein Wort ueber Ollama, LM Studio, ComfyUI, VRAM, Ordner, Klick, Enter, Esc, Drag and Drop. "This phone" statt "your machine", "Tap" statt "Click".

## 2. Navigationsmodell

### 2.1 Entscheidung

Vier Reiter in einer unteren Leiste: **Chat, Create, Models, Settings**. Jeder Reiter hat einen eigenen Zurueck-Stapel. Die Chat-Liste ist die Wurzel des Chat-Reiters, die Unterhaltung ist eine Vollbild-Seite darueber. Es gibt keine Seitenschublade.

### 2.2 Begruendung

- **Untere Leiste statt Kopfnavigation.** Die sechs Ziele des Desktop-Kopfes (Chat, Create, Compare, Benchmark, Models, Settings) passen nicht in 320 pt. Compare und Benchmark sind Werkzeuge in einem Zusammenhang und wandern dorthin: Compare ins Chat-Menue, Benchmark in Models. Uebrig bleiben vier Bereiche, das ist die Zahl, die eine untere Leiste mit 44 pt Zielen und lesbaren Namen traegt.
- **Chat-Liste als Seite statt Schublade.** Eine Schublade vom linken Rand kollidiert auf iOS mit der Wischgeste fuer Zurueck und auf Android mit der Systemgeste vom Rand. Als Wurzelseite ist die Liste mit beiden Gesten vereinbar: von der Unterhaltung fuehrt Zurueck zur Liste, wie in jeder Nachrichten-App. Die Liste hat ausserdem Platz fuer Suche, den Umschalter auf Remote und den Cloud-Schalter, die in einer Schublade gedraengt waeren.
- **Die Unterhaltung ohne Reiterleiste.** Auf einer geschobenen Seite ist die Leiste weg. Das Eingabefeld sitzt dann direkt ueber dem unteren Rand und bei offener Tastatur direkt ueber der Tastatur. Auf 568 pt Hoehe bleiben so auch mit Tastatur Nachrichten sichtbar.
- **Der erste Start landet trotzdem im Chat.** Nach dem Onboarding und bei jedem Kaltstart liegt der Stapel `[/chats, /chat/new]` im Reiter Chat, egal was vorher offen war (Runde 57, Davids Vorgabe). Der Nutzer kann sofort tippen, Zurueck fuehrt zur Liste. Nur die Rueckkehr aus dem Hintergrund behaelt den offenen Chat. Ausnahme: wurde die App mitten in einer Antwort beendet, oeffnet der Start diesen Chat (F9). Der neue Chat steht erst mit der ersten Nachricht in der Liste, leere Chats stapeln sich also nicht.
- **Models bleibt in beiden Modi sichtbar.** Am Desktop verschwindet Models im Cloud-Modus. Auf dem Handy ist das lokale Modell der Grund, warum die App ohne Netz arbeitet, deshalb bleibt der Reiter immer da.
- **Create ist immer sichtbar, auch lokal.** Im lokalen Modus oder ohne Anmeldung zeigt der Reiter das Schaufenster mit einem Knopf, der Cloud einschaltet. Das ist ehrlicher als ein Reiter, der verschwindet.

### 2.3 Regeln der Leiste

- Die Leiste ist nur auf den vier Wurzelseiten sichtbar. Geschobene Seiten, Blaetter und die offene Tastatur verdecken oder entfernen sie.
- Tippen auf den aktiven Reiter fuehrt zur Wurzel dieses Reiters und rollt dort nach oben.
- Ein Reiterwechsel behaelt den Stapel des verlassenen Reiters.
- Im Querformat wird die Leiste zur Schiene am linken Rand (72 pt breit plus Safe Area). Der Inhalt ist dort auf 42 rem Breite begrenzt und mittig.
- Die Beschriftung der Leiste waechst mit der Systemschrift nur bis 15 px. Darueber traegt das Symbol, der zugaengliche Name bleibt vollstaendig.
- Ein Punkt am Reiter Models zeigt laufende Downloads (zugaenglicher Name "Models, 1 download running").

### 2.4 Zurueck

| Ausloeser | Android | iOS | Wirkung |
|---|---|---|---|
| Systemgeste oder Zurueck-Taste | ja | entfaellt | schliesst das Oberste nach der Reihenfolge unten |
| Wischen vom linken Rand | Systemgeste | eigene Geste der Shell, 20 pt Randzone | wie oben, die Seite folgt dem Finger |
| Pfeil in der Kopfzeile | ja | ja | wie oben |
| Tippen auf den Schleier | ja | ja | schliesst Blatt oder Dialog |

Reihenfolge: 1. offene Tastatur, 2. Dialog, 3. Blatt (bei Blatt mit Unterseite zuerst die Unterseite), 4. Vollbildansicht (Maskeneditor, Bildansicht), 5. oberste Seite des Stapels, 6. von einer Reiterwurzel zum Chat-Reiter, 7. von `/chats` verlaesst Android die App, iOS tut nichts.
Ungesicherte Eingaben (Persona-Editor, Workflow-Baukasten, Maske) fragen vor dem Schliessen nach (G3 "Discard changes?").
Waehrend des Onboardings fuehrt Zurueck einen Schritt zurueck, vom ersten Schritt aus verlaesst Android die App, ohne das Onboarding als erledigt zu merken.

### 2.5 Hell, Dunkel, Cloud

- Thema: System, Dark, Light. Vorgabe ist System. Die Klasse `dark` oder `light` sitzt wie am Desktop auf `html`.
- Der Cloud-Schalter (G11) steht oben rechts auf den Wurzeln Chat und Create und als Segment im Modell-Blatt. Einschalten fragt immer nach ("Switch to Cloud?"), Ausschalten nie. Der zweistufige Klick des Desktops wird so zu einem Dialog, der unter dem Finger bleibt.

## 3. Routenliste

Pfade sind Kennungen des eigenen Stapel-Routers, keine URLs im Browser. `:id` ist eine Kennung aus dem jeweiligen Store.

| Kuerzel | Route | Art | Reiter | Titel in der App |
|---|---|---|---|---|
| A1 | `/welcome` | Ablauf | keiner | (ohne) |
| A2 | `/setup/model` | Ablauf | keiner | Pick a starter model |
| A3 | `/setup/documents` | Ablauf | keiner | Document Chat |
| A4 | `/setup/done` | Ablauf | keiner | You're all set |
| C1 | `/chats` | Wurzel | Chat | Chats |
| C2 | `/chat/:id`, `/chat/new` | Seite | Chat | Titel des Chats |
| C3 | Blatt `model` | Blatt | Chat | Model |
| C4 | Blatt `attach` | Blatt | Chat | Add to message |
| C5 | Blatt `chat-options` mit Unterseiten | Blatt | Chat | Chat options |
| C6 | Blatt `message` | Blatt | Chat | Message, Answer |
| C7 | Blatt `chat-menu` | Blatt | Chat | Titel des Chats |
| C8 | `/chat/:id/documents` | Seite | Chat | Documents |
| C9 | `/chat/:id/compare` | Seite | Chat | Compare |
| C10 | `/chat/:id/tasks` | Seite | Chat | Background tasks |
| C11 | `/chat/:id/preview/:blockId` | Vollbild | Chat | Preview |
| C12 | Blatt `approval` | Blatt | Chat | Allow this step? |
| C13 | `/chat/:id/group` | Seite | Chat | Group chat |
| C14 | `/chat/:id/file/:fileId` | Vollbild | Chat | Dateiname |
| R1 | `/chats` Segment Remote | Wurzel | Chat | Chats |
| R2 | `/remote/connect` | Seite | Chat | Connect to desktop |
| R3 | `/remote/scan` | Vollbild | Chat | Scan code |
| R4 | `/remote/chat/:id` | Seite | Chat | Titel des Chats |
| R5 | `/remote/help` | Seite | Chat, Settings | How it works |
| K1 | `/create` | Wurzel | Create | Create |
| K2 | Blatt `tools` | Blatt | Create | Tools |
| K3 | Blatt `create-model` | Blatt | Create | Model |
| K4 | Blatt `run-settings` mit Unterseiten | Blatt | Create | Run settings |
| K5 | Blatt `source` | Blatt | Create | Add source |
| K6 | `/create/gallery` | Seite | Create | Gallery |
| K7 | `/create/item/:id` | Vollbild | Create | Image, Video, Track |
| K8 | Blatt `result` | Blatt | Create | Image, Video, Track |
| K9 | `/create/mask` | Vollbild | Create | Paint the area |
| K10 | `/create/characters` | Seite | Create | Characters |
| K11 | `/create/characters/new` | Seite | Create | New character |
| K12 | `/create/presets` | Seite | Create | Presets |
| K13 | `/create/showcase` | Seite | Create | What you can make |
| K14 | `/create/batch` | Seite | Create | Batch |
| M1 | `/models` | Wurzel | Models | Models |
| M2 | `/models/:id` | Seite | Models | Modellname |
| M3 | `/models/downloads` | Seite | Models | Downloads |
| M4 | `/models/benchmark` | Seite | Models | Benchmark |
| E1 | `/settings` | Wurzel | Settings | Settings |
| E2 | `/settings/account` | Seite | Settings | Account |
| E3 | `/cloud` | Seite | jeder | LU Cloud |
| E4 | `/settings/appearance` | Seite | Settings | Appearance |
| E5 | `/settings/chat` | Seite | Settings | Chat defaults |
| E6 | `/settings/personas`, `/settings/personas/:id` | Seite | Settings | Personas |
| E7 | `/settings/memory`, `/settings/memory/:id` | Seite | Settings, Chat | Memory |
| E8 | `/settings/agent` | Seite | Settings | Agent and permissions |
| E9 | `/settings/search` | Seite | Settings | Web search |
| E10 | `/settings/workflows`, `/settings/workflows/:id` | Seite | Settings | Workflows |
| E11 | `/settings/voice` | Seite | Settings | Voice |
| E12 | `/settings/providers`, `/settings/providers/:id` | Seite | Settings | Providers |
| E13 | `/settings/engine` | Seite | Settings | On device engine |
| E14 | `/settings/storage` | Seite | Settings | Storage and downloads |
| E15 | `/settings/remote` | Seite | Settings | Remote desktop |
| E16 | `/settings/data`, `/settings/data/import` | Seite | Settings | Backup and import |
| E17 | `/settings/privacy` | Seite | Settings | Privacy |
| E18 | `/settings/content-policy` | Seite | Settings | Content policy |
| E19 | `/settings/troubleshooting` | Seite | Settings | Troubleshooting |
| E20 | `/settings/about` | Seite | Settings | About LU |
| E21 | `/whats-new` | Seite | jeder | What is new |
| G1 bis G14 | ohne Route | global | alle | siehe Abschnitt 4.7 |

Deep Links von aussen (OAuth-Rueckkehr, Remote-Kopplung) oeffnen nie selbst eine Aktion. Sie legen ein Angebot ab, das die Shell als Blatt zeigt und das nach 5 Minuten verfaellt.

## 4. Screens

Gemeinsamer Aufbau jeder Seite: Kopfzeile (44 pt hoch plus Safe Area oben), rollbarer Inhalt, optional Fusszeile oder Eingabefeld (plus Safe Area unten), auf Wurzeln darunter die Reiterleiste. Kopfzeilen von Seiten haben links Zurueck (Name "Back"), mittig den Titel, rechts hoechstens zwei Symbolknoepfe. Wurzeln haben links den grossen Titel in Space Grotesk.

### 4.1 Onboarding

**A1 Welcome** (`/welcome`)
Zweck: Sagen, was LU auf dem Handy ist, und den Einstieg anbieten.
Aufbau: mittig Monogramm 56 pt, Titel "Locally Uncensored", ein Absatz "Private AI on your phone. Pick a model once, then chat without a connection. Nothing leaves this phone unless you turn on Cloud." Unten zwei Knoepfe.
Elemente:
- A1.1 "Get started" (Hauptknopf): weiter zu A2.
- A1.2 "I have an LU Cloud account": oeffnet E2 Anmelden als Seite im Ablauf, nach Erfolg weiter zu A2 mit dem Zusatzknopf "Skip, use Cloud only".
Zustaende: Kein Ladezustand. Nach einem Speicherverlust des WebView mit vorhandener Sicherung erscheint statt A1 die Zeile "Restoring your chats" mit Fortschritt, danach die App.

**A2 Pick a starter model** (`/setup/model`)
Zweck: Ein passendes lokales Modell waehlen und laden.
Aufbau: Kopf mit Zurueck und zwei Fortschrittsstrichen. Titel, ein Satz, Geraetezeile "This phone: 8 GB memory, 41 GB storage free." Segment Mainstream oder Unfiltered. Auswahlkarten (Name, Groesse, ein Satz, Passt-Anzeige). Fusszeile mit Hauptknopf.
Elemente:
- A2.1 Zurueck: zu A1.
- A2.2 Segment "Mainstream" / "Unfiltered": wechselt die Liste.
- A2.3 Modellkarte (Radio): waehlt das Modell, die Karte bekommt den Akzentrand, der Hauptknopf nennt die Groesse. Zu grosse Modelle sind sichtbar, aber nicht waehlbar; Tippen zeigt den Toast "Too large. It needs about 9 GB of memory and this phone has 8 GB."
- A2.4 "Download 2.5 GB": prueft Speicher (G9 bei Mangel), startet den Download, die Fusszeile zeigt Fortschritt.
- A2.5 "Skip for now": weiter zu A3 ohne Modell.
- A2.6 "Pause" / "Resume" am Fortschritt: haelt an, setzt fort.
- A2.7 "Cancel": bricht ab, die Karte ist wieder waehlbar, kein roter Fehler.
- A2.8 "Continue" (waehrend oder nach dem Download): weiter zu A3, der Download laeuft weiter.
- A2.9 "Use this model" (nur wenn schon Modelle installiert sind, beim erneuten Durchlauf): setzt das aktive Modell ohne Download.
Zustaende: Laden der Empfehlung (drei Skelettkarten). Kein Netz: Hinweis "No internet. You need a connection once to download a model." mit "Try again" und "Skip for now". Download unterbrochen: Hinweis wie M3 mit "Resume". Speicher voll: G9. Kein passendes Modell (sehr kleines Geraet): Text "No local model fits this phone. You can still use LU Cloud." mit "Continue".

**A3 Document Chat** (`/setup/documents`)
Zweck: Das Embedding-Modell fuer Dokumente anbieten.
Aufbau: Symbol, Titel "Document Chat", Text "Ask questions about your PDFs and notes. This needs one small extra model, 84 MB, that stays on this phone. Optional."
Elemente:
- A3.1 Zurueck: zu A2.
- A3.2 "Install 84 MB": startet den Download, zeigt Fortschritt, bei Erfolg "Document Chat is ready." und weiter.
- A3.3 "Skip for now": weiter zu A4.
Zustaende: schon installiert ("Already installed. Document Chat is ready." und "Continue"). Fehler wie A2.

**A4 You're all set** (`/setup/done`)
Zweck: Abschluss und Uebergang in den Chat.
Aufbau: Haken, Titel, ein Satz, der den Stand nennt: "Gemma 3 4B is ready." oder "Gemma 3 4B is still downloading. You can start once it is done, or use LU Cloud now." oder "No model yet. Install one in Models."
Elemente:
- A4.1 "Start chatting": merkt das Onboarding als erledigt und oeffnet `[/chats, /chat/new]`.
- A4.2 "Open Models" (nur ohne Modell): oeffnet M1.

### 4.2 Chat

**C1 Chats** (`/chats`, Wurzel)
Zweck: Alle Unterhaltungen auf diesem Handy finden, eine neue beginnen, auf Remote wechseln.
Aufbau: grosser Titel "Chats" mit Cloud-Schalter rechts. Segment "On this phone" / "Remote desktop". Suchfeld. Liste (Titel, erste Zeile der letzten Antwort, Modell und Zeit). Feste Aktionsleiste "New chat" ueber der Reiterleiste.
Elemente:
- C1.1 Cloud-Schalter (Rolle switch, Name "Cloud"): aus nach an oeffnet G11, an nach aus schaltet sofort auf lokal und zeigt den Toast "Back on device". Ohne Abo oeffnet er E3.
- C1.2 Segment: wechselt zwischen lokaler Liste und R1.
- C1.3 Suchfeld "Search chats": filtert die Liste beim Tippen ueber Titel und Inhalt.
- C1.4 Chat-Zeile: oeffnet C2 mit diesem Chat. Seit Runde 57 eine flache Liste ohne Karte, Trennlinien zwischen den Zeilen, eine Zeile Vorschau.
- C1.5 "More" an der Zeile (Name "More for <Titel>"): oeffnet C7. Langes Druecken auf die Zeile tut dasselbe.
- C1.6 "New chat": oeffnet `/chat/new`. Mit Chats der Knopf in der Fusszeile, in der leeren Liste das Plus in der Kopfzeile (Runde 57).
- C1.7 Link "Restore from backup" (nur wenn eine Sicherung gefunden wurde und die Liste leer ist): oeffnet E16. Seit Runde 57 ein ruhiger Link mittig unter dem Satz statt einer Zeile.
Zustaende: Leer: Monogramm, "Ask LU anything", Satz "Your chats stay on this phone.", darunter hoechstens C1.7; C1.6 sitzt dann als Plus in der Kopfzeile. Suche ohne Treffer: "No chats match <Text>." mit "Clear search". Laden aus dem Speicher: vier Skelettzeilen, hoechstens 300 ms sichtbar. Speicher nicht lesbar: G4.

**C2 Unterhaltung** (`/chat/:id`)
Zweck: Schreiben, lesen, steuern. Der wichtigste Screen der App.
Aufbau von oben nach unten:
1. Kopfzeile: Zurueck, Titel des Chats (eine Zeile, gekuerzt), "More".
2. Hinweisbereich (nur bei Bedarf, je eine Zeile): Offline (G7), Engine-Hinweise (G10), Zielzeile (`/goal`), Laufzeile (`/loop`), Plan-Band (`todo_write`), Hinweis "This chat ran on <Modell> before".
3. Verlauf: Nutzernachricht rechts in einer Blase, Antwort links ohne Blase mit der Zeile "<Monogramm> <Modell>" darueber. Unter der letzten Antwort eine Aktionsreihe.
4. Eingabefeld: Statuszeile mit Chips, Textfeld, Bedienzeile.
Bedienzeile von links: Anhaengen, Optionen, Modellwahl (nimmt den Rest der Breite), rechts ein gemeinsamer Platz fuer Diktat, Senden oder Stop. Leeres Feld zeigt das Mikrofon, Text oder Anhang zeigt Senden, ein laufender Lauf zeigt Stop. Der Platz wechselt nie die Groesse.
Elemente:
- C2.1 Zurueck: zu C1. Ein laufender Lauf laeuft weiter und ist in der Liste als "Answering" markiert.
- C2.2 "More" (Name "Chat menu"): oeffnet C7.
- C2.3 Textfeld "Message": waechst bis 6 Zeilen, dann rollt es. Fokus oeffnet die Tastatur, der Verlauf rollt ans Ende. Schraegstrich am Anfang zeigt ueber dem Feld die drei Befehle `/compact`, `/goal`, `/loop` als Liste.
- C2.4 "Attach" (Plus): oeffnet C4.
- C2.5 "Chat options" (Regler): oeffnet C5.
- C2.6 Modellwahl (Name "Model: <Name>. Change model"): oeffnet C3. Der Punkt ist gruen fuer lokal, violett fuer Cloud. Im Cloud-Modus ohne Wahl steht "Choose a model".
- C2.7 "Dictate" (Mikrofon): fragt beim ersten Mal die Mikrofon-Berechtigung an, nimmt auf, zeigt statt des Textfeldes Pegel, Uhr und "Tap to stop". Zweites Tippen beendet, der Text landet im Feld. Nur mit Cloud; ohne Cloud oeffnet das Tippen ein Blatt "Dictation uses LU Cloud" mit "Turn on Cloud" und "Not now".
- C2.8 "Send": sendet. Im Cloud-Modus ohne Modell bleibt der Text stehen und C3 oeffnet sich mit dem Toast "Choose a model first. Your message is kept."
- C2.9 "Stop": haelt den Lauf an, der Teil bleibt stehen.
- C2.10 Status-Chip "Agent": oeffnet C5 an der Stelle Agent mode.
- C2.11 Status-Chip "<n> documents": oeffnet C8.
- C2.12 Status-Chip "Thinking", "Persona: <Name>", "Group: <n> models", "Caveman": oeffnet C5 an der passenden Stelle.
- C2.13 Status-Chip "Cloud, uses credits": oeffnet G13 (Flash-Hinweis und Preis dieser Runde).
- C2.14 Kontextanzeige im Status ("31%"): oeffnet C5 Unterseite Context window. Ab 80 Prozent in der Hinweisfarbe (`--m-warn`, das ruhige Grau, kein Gelb) und mit dem Warnsymbol, ab 95 Prozent mit dem Knopf "Compact now". Die Stufe traegt das Symbol und der Text, nie die Farbe allein.
- C2.15 Anhang-Chip am Feld (Bild oder Datei): Tippen oeffnet die Vorschau (C14), das X am Chip entfernt ihn.
- C2.16 "Copy" unter der letzten Antwort: kopiert, Toast "Copied" nur bei Erfolg.
- C2.17 "Regenerate": erzeugt die letzte Antwort neu.
- C2.18 "Read aloud": liest ueber die Cloud-Stimme vor, der Knopf wird zu "Stop reading". Ohne Cloud und mit Systemstimme liest die Systemstimme; ohne beides oeffnet sich das Blatt "Read aloud uses LU Cloud".
- C2.19 "More" an der Antwort: oeffnet C6. Langes Druecken auf jede Nachricht oeffnet ebenfalls C6.
- C2.20 Denkblock "Thought for 4 s": klappt auf und zu.
- C2.21 Werkzeugzeile (`web_search`, Haken, Dauer): klappt Eingabe und Ergebnis auf. Mehrere Aufrufe stehen als Band "3 steps", das aufklappt.
- C2.22 Codeblock "Copy": kopiert den Code. Der Block rollt waagerecht.
- C2.23 Codeblock "Preview" (nur HTML): oeffnet C11.
- C2.24 Datei-Karte (Artefakt): oeffnet C14.
- C2.25 Verdichtungsblock "Earlier messages were compacted": klappt die Zusammenfassung auf.
- C2.26 Hinweis unter einer ablehnenden Antwort, Knopf "New chat": oeffnet `/chat/new` mit demselben Modell.
- C2.27 Fehlerzeile "Documents were not searched for this message", Knopf "Try again": wiederholt die Suche.
- C2.28 Zielzeile, Knopf "Clear goal": entfernt das Ziel.
- C2.29 Laufzeile, Knopf "Stop loop": beendet `/loop`.
- C2.30 Plan-Band: klappt die Aufgabenliste des Modells auf.
- C2.31 "Jump to latest" (erscheint, wenn der Nutzer hochgerollt hat): rollt ans Ende.
- C2.32 Bild in einer Nachricht: oeffnet die Vollbildansicht C14.
- C2.33 Kostenhinweis im Gruppenchat ueber dem Feld ("One message, 3 answers, about 6 credits"): reine Anzeige, Tippen oeffnet C13.
- C2.34 Link in einer Antwort: oeffnet den Systembrowser nach Rueckfrage im Blatt "Open link?" mit der vollen Adresse.
Zustaende:
- Leer: Monogramm, "Ask LU anything", "Type below to start." oder "Choose a model below.", darunter Modellname. Ohne installiertes Modell und ohne Cloud: "No model yet." mit den Knoepfen "Install a model" (M1) und "Use LU Cloud" (E3).
- Modell laedt: Zeile "Loading Gemma 3 4B" mit unbestimmtem Fortschritt ueber dem Feld, Senden ist moeglich und wird eingereiht.
- Antwort laeuft: Schreibmarke am Ende, Laufanzeige "Answering, 0:07" im Hinweisbereich, Stop im Bedienplatz.
- Agent laeuft: Laufanzeige nennt den Schritt ("Reading page").
- Netz bricht im Stream: Fehlerkasten im Verlauf, siehe 5.1.
- Vom System beendet: Hinweis G8.
- Guthaben leer: G5. Sitzung abgelaufen: G6.
- Modell kann keine Werkzeuge: Chip "Agent" zeigt ein Warnzeichen, Tippen erklaert "This model cannot use tools. Pick another model or turn on Small model mode."
- Wechsel in den Hintergrund: der Lauf wird angehalten und gespeichert, bei Rueckkehr steht "Paused while LU was in the background." mit "Continue".

**C3 Model** (Blatt)
Zweck: Modell fuer diesen Chat waehlen und zugleich den Modus sehen.
Aufbau: Segment "On device" / "LU Cloud". Darunter die Liste des gewaehlten Segments. Weitere Anbieter mit eigenem Schluessel erscheinen als dritte Gruppe "Your providers" im Segment On device unter den lokalen Modellen.
Elemente:
- C3.1 Segment: zeigt die jeweilige Liste. Der Modus wechselt erst mit der Wahl eines Modells.
- C3.2 Lokale Modellzeile (Radio, Name, Groesse, Faehigkeiten, Passt-Anzeige): waehlt und laedt das Modell, das Blatt schliesst, C2 zeigt "Loading".
- C3.3 Zeile eines laufenden Downloads: oeffnet M3.
- C3.4 "Get more models": schliesst das Blatt und oeffnet M1.
- C3.5 Suchfeld "Search models" (Cloud): filtert.
- C3.6 Filter-Chips "Fast", "Smart", "Vision", "No refusals": filtern, mehrere zugleich moeglich.
- C3.7 Cloud-Modellzeile (Radio, Name, ein Satz, Marken "No refusals", "No credits today"): waehlt das Modell. Kommt der Nutzer aus dem lokalen Modus, erscheint zuerst G11.
- C3.8 "Price" (Info-Symbol an der Zeile): zeigt im Blatt eine Unterseite mit dem Preis je 1.000 Woerter Ein- und Ausgabe.
- C3.9 "Sign in to LU Cloud" (abgemeldet): oeffnet E2.
- C3.10 "See plans" (angemeldet ohne Abo): oeffnet E3.
- C3.11 Zeile eines Anbieter-Modells: waehlt es.
- C3.12 "Close": schliesst.
Zustaende: Keine lokalen Modelle: "No model on this phone yet." mit C3.4. Katalog laedt: Skelettzeilen und "The hosted catalogue is still loading." Katalog nicht erreichbar: "Could not load cloud models. Check your connection." mit "Try again". Suche leer: "No model matches."

**C4 Add to message** (Blatt)
Elemente:
- C4.1 "Take photo": oeffnet die Kamera, das Foto wird Anhang.
- C4.2 "Photo library" (Zusatz "Up to 5 images"): oeffnet die Fotoauswahl des Systems.
- C4.3 "File" (Zusatz "Up to 3 files, 64 MB each"): oeffnet die Dokumentauswahl.
- C4.4 "Documents for this chat" (Zusatz "<n> added, searched on this phone"): oeffnet C8.
- C4.5 "Close".
Zustaende: Modell ohne Bildverstaendnis: C4.1 und C4.2 tragen den Zusatz "This model cannot read images" und oeffnen C3 mit dem Filter Vision. Grenze erreicht: Toast "You can attach up to 5 images." Datei zu gross: Toast "This file is larger than 64 MB."

**C5 Chat options** (Blatt mit Unterseiten)
Zweck: Alles, was am Desktop als Knopfreihe ueber und unter dem Eingabefeld sitzt.
Aufbau: drei Gruppen. Unterseiten oeffnen im selben Blatt mit Zurueck-Pfeil in der Blattkopfzeile.
Elemente Gruppe 1 (Schalter, wirken sofort):
Seit Runde 6 steht Gruppe 1 unter zwei Ueberschriften: "This chat" (C5.1, C5.4, C5.5, gelten je Chat) und "All chats" (C5.2, C5.3, C5.6, sind Einstellungen der App und gelten in jedem Chat).
- C5.1 "Agent mode" (Zusatz "Let the model use tools step by step"): schaltet je Chat. Beim ersten Einschalten zeigt eine Unterseite die Einfuehrung mit "Turn on" und "Not now".
- C5.2 "Thinking": schaltet. Bei Modellen, die immer denken, gesperrt an mit dem Zusatz "Always on for this model". Bei Modellen ohne Denken nicht gezeigt.
- C5.3 "Reasoning effort" (nur wenn Thinking an ist): Segment Low, Medium, High, Max.
- C5.4 "Web search" (Zusatz "Search and read pages when needed"): schaltet die Chat-Werkzeuge Suche und Seite holen.
- C5.5 "Write files" (Zusatz "Let the model save files into this chat"): schaltet das Werkzeug Datei schreiben.
- C5.6 "Small model mode" (nur lokal): schaltet das schlanke Werkzeugprofil.
Elemente Gruppe 2 (fuehren auf Unterseiten):
- C5.7 "Persona": Unterseite mit Schalter "Use a persona in this chat", Radioliste der Personas und "Manage personas" (E6).
- C5.8 "Group chat": oeffnet C13.
- C5.9 "Caveman mode": Unterseite mit Segment Off, Lite, Full, Ultra.
- C5.10 "Memory": oeffnet E7 als Seite.
- C5.11 "Workflows": Unterseite mit der Liste der Workflows, Tippen startet den Workflow in diesem Chat. "Manage workflows" fuehrt zu E10.
Elemente Gruppe 3:
- C5.12 "Sampling": Unterseite mit Reglern Temperature, Top P, Max length und "Reset to defaults".
- C5.13 "Context window": Unterseite mit Fuellstand als Balken, Auswahl der Fenstergroesse (nur Werte, die das Geraet traegt) und "Compact now".
- C5.14 "Permissions for this chat": Unterseite mit je einer Zeile pro Werkzeuggruppe (Web, Files, Memory, Workflows, Sub agents) und Segment Blocked, Ask, Auto. "Use app defaults" setzt zurueck.
- C5.15 "Set a goal": Unterseite mit Textfeld und "Set goal" (entspricht `/goal`).
- C5.16 "Repeat a task": Unterseite mit Textfeld, Intervall und "Start loop" (entspricht `/loop`), Hinweis "Runs only while LU is open."
- C5.17 "Close".
Zustaende: Gesperrte Zeilen zeigen den Grund im Zusatz, nie nur grau.

**C6 Message / Answer** (Blatt)
Elemente:
- C6.1 "Copy": kopiert den sichtbaren Text.
- C6.2 "Read aloud" (nur Antworten).
- C6.3 "Regenerate" (nur Antworten).
- C6.4 "Edit": Nutzernachricht wandert ins Eingabefeld zum Aendern und erneuten Senden; eine Antwort wird im Vollbild-Editor geoeffnet mit "Save" und "Cancel".
- C6.5 "Share": Teilen-Blatt des Systems mit dem Text.
- C6.6 "Select text": oeffnet die Nachricht als Vollbildseite mit markierbarem Text.
- C6.7 "Delete": Rueckfrage G3 "Delete this message?".
- C6.8 "Close".

**C7 Chat-Menue** (Blatt)
Elemente:
- C7.1 "Rename": Dialog mit Textfeld, "Save".
- C7.2 "Export" (Zusatz "Markdown or JSON"): Unterseite mit zwei Zeilen, dann Teilen-Blatt des Systems. Toast "Export ready" erst, wenn die Datei uebergeben ist.
- C7.3 "Compare two models": oeffnet C9.
- C7.4 "Background tasks" (Zusatz mit Zahl): oeffnet C10.
- C7.5 "Documents": oeffnet C8.
- C7.6 "Files in this chat" (Arbeitsordner des Agenten): Unterseite mit Dateiliste, Tippen oeffnet C14.
- C7.7 "Delete chat": Rueckfrage G3 "Delete this chat?".
- C7.8 "Close".

**C8 Documents** (`/chat/:id/documents`)
Zweck: Dokumente je Chat hinzufuegen und befragen.
Aufbau: Schalter "Search documents in this chat". Satz, wohin der Text geht: "Documents are read and searched on this phone. Only the passages that match your question are sent to the model." (im Cloud-Modus: "to LU Cloud"). Liste der Dokumente. Fusszeile "Add document".
Elemente:
- C8.1 Schalter: schaltet die Suche fuer diesen Chat.
- C8.2 "Add document": Dokumentauswahl (PDF, DOCX, TXT), danach Zeile mit Fortschritt "Reading" und "Indexing 40%".
- C8.3 Dokumentzeile: klappt die zuletzt gefundenen Stellen mit Wertung auf.
- C8.4 "Remove" an der Zeile: Rueckfrage G3.
- C8.5 "Remove all": Rueckfrage G3.
- C8.6 Karte "Install the document model, 84 MB" (nur wenn es fehlt): laedt und zeigt Fortschritt.
- C8.7 "Import chats from ChatGPT, Claude or Gemini": oeffnet E16 Import.
Zustaende: Leer: "No documents in this chat yet." Dokument zu gross oder nicht lesbar: Zeile mit "Could not read this file." und "Remove". Embedding-Modell fehlt: nur C8.6 und Erklaerung. Indexieren im Hintergrund unterbrochen: Zeile "Paused. Open LU to continue." mit "Continue".

**C9 Compare** (`/chat/:id/compare`)
Zweck: Derselbe Prompt an zwei Modelle.
Aufbau: zwei Modellwaehler A und B oben, Segment "A" / "B" fuer die Antwortansicht, im Querformat beide nebeneinander. Unten ein Eingabefeld.
Elemente:
- C9.1 Modell A, C9.2 Modell B: oeffnen C3 als Auswahl.
- C9.3 Segment A/B: wechselt die Ansicht.
- C9.4 Textfeld und "Send": sendet an beide nacheinander.
- C9.5 "Stop".
- C9.6 "Keep this answer" unter jeder Antwort: uebernimmt sie in den Chat und schliesst Compare.
Zustaende: Zwei lokale Modelle: Hinweis "This phone holds one model at a time. LU answers with A, then loads B. That takes longer." Ein lokales und ein Cloud-Modell laufen gleichzeitig.

**C10 Background tasks** (`/chat/:id/tasks`)
Elemente: C10.1 Aufgabenzeile (klappt Verlauf auf), C10.2 "Stop" je Aufgabe, C10.3 "Message agent" (Textfeld und Senden), C10.4 "Stop all".
Zustaende: Leer "No tasks running." Hinweis oben: "Tasks pause when LU is in the background."

**C11 Preview** (Vollbild)
Elemente: C11.1 "Close", C11.2 Segment "Phone" / "Wide" (Breite des Rahmens), C11.3 "Reload".
Zustaende: Der Rahmen ist abgeschottet; ein Fehler im Code zeigt "This page could not be shown."

**C12 Allow this step?** (Blatt, erscheint von selbst)
Aufbau: Werkzeugname in Worten ("Write a file"), Ziel ("notes.md in this chat"), aufklappbare Einzelheiten.
Elemente: C12.1 "Allow" (Hauptknopf), C12.2 "Deny", C12.3 "Always allow in this chat" (setzt die Gruppe auf Auto), C12.4 "Details".
Zustaende: Das Blatt laesst sich nicht wegwischen; Zurueck bedeutet Deny.

**C13 Group chat** (`/chat/:id/group`)
Elemente: C13.1 Schalter "Group chat in this conversation", C13.2 "Add model" (bis 4, oeffnet C3 als Auswahl), C13.3 Teilnehmerzeile mit "Persona" (Unterseite Radioliste) und "Remove", C13.4 Kostenzeile (Anzeige).
Zustaende: Mehr als ein lokales Modell: Hinweis wie C9. Nur ein Modell: Hinweis "Add a second model to start."

**C14 Datei- und Bildansicht** (Vollbild)
Elemente: C14.1 "Close", C14.2 "Share" (Teilen-Blatt), C14.3 "Save to Photos" (nur Bilder), C14.4 Zoomen mit zwei Fingern und Doppeltipp.
Zustaende: Vorschau nicht moeglich: Dateiname, Groesse und C14.2.

### 4.3 Remote

**R1 Remote desktop** (Segment in `/chats`)
Zweck: Das Handy als Client eines Desktop-LU.
Elemente:
- R1.1 "Scan QR code": oeffnet R3.
- R1.2 "Enter address and passcode": oeffnet R2.
- R1.3 "How it works": oeffnet R5.
- R1.4 (verbunden) Kopfzeile "Connected to <Name>" mit "Disconnect": trennt nach Rueckfrage.
- R1.5 (verbunden) Remote-Chat-Zeile: oeffnet R4.
- R1.6 (verbunden) "New remote chat": oeffnet R4 leer.
Zustaende: Nicht verbunden: Erklaerung und R1.1 bis R1.3. Verbinden: "Connecting to <Adresse>". Desktop nicht erreichbar: "Could not reach your desktop. Is LU open there, and are both devices on the same network?" mit "Try again" und "Enter address and passcode". Passcode abgelehnt: "That passcode did not match." Sitzung beendet (Desktop hat neu gestartet): "The desktop ended the session. Scan the new code." Die Remote-Chats bleiben lesbar.

**R2 Connect to desktop** (`/remote/connect`)
Elemente: R2.1 Feld "Address" (Tastatur fuer Adressen), R2.2 Feld "Passcode" (Ziffern), R2.3 "Connect", R2.4 "Scan QR code instead".
Zustaende: Pruefung laeuft (Knopf zeigt Fortschritt). Fehlertexte unter dem jeweiligen Feld.

**R3 Scan code** (Vollbild)
Elemente: R3.1 "Close", R3.2 "Enter address instead", R3.3 Taschenlampe.
Zustaende: Kamera nicht erlaubt: "LU needs the camera to scan the code." mit "Open system settings" und R3.2. Code erkannt: Adresse wird gezeigt, Passcode wird in R2 abgefragt.

**R4 Remote-Unterhaltung** (`/remote/chat/:id`)
Wie C2, mit diesen Unterschieden: Kopfzeile traegt die Unterzeile "On <Name des Desktops>". Die Modellwahl zeigt die Modelle des Desktops. C4 bietet Fotos und Dateien an, C5 zeigt nur Agent mode, Thinking, Persona und Caveman. Werkzeuge laufen auf dem Desktop mit dessen Rechten; die Seite sagt das einmal im Hinweisbereich.
Zusaetzliche Zustaende: Verbindung verloren mitten in der Antwort: Fehlerkasten "Connection to your desktop was lost." mit "Reconnect".

**R5 How it works** (`/remote/help`)
Reiner Text in drei Abschnitten (What it does, How to connect, What stays private), aus Sicht des Handys geschrieben. Element: R5.1 "Connect now" fuehrt zu R1.

### 4.4 Create

Create laeuft nur ueber LU Cloud. Der Store wird auf `backend = 'cloud'` festgelegt, es gibt keine lokale Spur und keinen Text darueber.

**K1 Create** (`/create`, Wurzel)
Zweck: Ein Werkzeug waehlen, Eingaben geben, Preis sehen, erzeugen, Ergebnis nutzen.
Aufbau von oben nach unten:
1. Kopf: Titel "Create", Guthaben-Chip (Blitz und Zahl), "Gallery".
2. Werkzeugleiste, waagerecht rollbar: "All" und dann die Werkzeuge mit Symbol und Kurzname.
3. Buehne: Ergebnis, Wartebild, Quellbild oder leerer Zustand (ein Satz). Bei Werkzeugen mit eigenen Eingaben stehen diese hier als Karten (siehe Tabelle unten). Was die Buehne zeigt, steht in der Mitte ueber dem Eingabefeld. Seit Runde 45 gibt es keine Beispiele mehr: auf einem aktuellen Handy (412x915) passt jedes Werkzeug ohne Rollen auf den ersten Bildschirm. Mit sehr grosser Schrift rollt die Seite als eine Spalte, "Create" steht dann fest darunter.
4. Eingabefeld: Prompt, Zusammenfassungszeile "1 image · 1:1 · Standard" mit Preis rechts, Bedienzeile.
Elemente:
- K1.1 Guthaben-Chip (Name "1,240 credits. Open account"): oeffnet E2.
- K1.2 "Gallery": oeffnet K6.
- K1.3 "All": oeffnet K2.
- K1.4 Werkzeug-Chip (Radio): wechselt das Werkzeug, Buehne und Feld passen sich an.
- K1.5 Prompt-Feld: Platzhalter je Werkzeug ("Describe your image", "Describe the motion and the scene").
- K1.6 Zusammenfassungszeile mit Preis: oeffnet K4.
- K1.7 "Add source" (Plus): oeffnet K5.
- K1.8 "Settings" (Regler): oeffnet K4.
- K1.9 Modellwahl: oeffnet K3.
- K1.10 "Create" (Hauptknopf): prueft den Prompt (Sperre gegen Darstellungen Minderjaehriger), prueft Guthaben, startet den Auftrag. Waehrend des Laufs wird der Knopf zu "Cancel".
- K1.11 entfallen (Runde 45, Beispiele entfernt).
- K1.12 Ergebnis antippen: oeffnet K7.
- K1.13 "Save" unter dem Ergebnis: sichert in Fotos (Bild, Video) oder Dateien (Ton). Toast "Saved to Photos" nach Erfolg.
- K1.14 "Share": Teilen-Blatt.
- K1.15 "Edit": wechselt auf das Werkzeug Edit mit diesem Bild als Quelle.
- K1.16 "Animate": wechselt auf Animate mit diesem Bild als Quelle.
- K1.17 "More": oeffnet K8.
- K1.18 Quellbild-Kachel: Tippen oeffnet K7, X entfernt die Quelle, "Paint mask" oeffnet K9 (Edit, Erase).
- K1.19 Referenzfoto-Kacheln (bis 5) mit "Add reference": Fotoauswahl; X entfernt.
- K1.20 "Cancel and refund" im Wartebild: bricht den Auftrag ab.
- K1.21 Hinweis "Cloud results stay available for 30 days", Knopf "Got it": blendet den Hinweis aus.
- K1.22 Preset-Schiene (waagerecht, nur Image und Video): Tippen setzt das Preset; "All presets" oeffnet K12.
- K1.23 Zeile "Batch: 12 images" (nach Mehrfachauswahl): oeffnet K14.
Eingaben je Werkzeug auf der Buehne:

| Werkzeug | Zusaetzliche Karten auf der Buehne | Prompt |
|---|---|---|
| Image | keine | ja |
| Edit | Quellbild, optional "Paint mask" | ja |
| Cutout | Quellbild | nein |
| Enhance | Quellbild, Segment 2K, 4K, 8K | nein |
| Erase | Quellbild, "Paint mask" ist Pflicht | nein |
| Video | keine | ja |
| Animate | Quellbild | ja |
| Character | Karte "Your characters" (oeffnet K10), gewaehlter Charakter | ja |
| Talking | Karte Presenter (Auswahl aus Gesichtern oder eigenes Foto), Karte Voice (Text eingeben und Stimme erzeugen, oder Tondatei waehlen) | nein |
| Music | Segment Style / Lyrics, Laenge | ja |
| Extend | Karte "Pick a clip" (oeffnet K6 als Auswahl) | ja |
| Motion | Karte Portrait (Foto), Karte Motion video (Video vom Geraet) | optional |

Zustaende:
- Lokaler Modus oder abgemeldet: Schaufenster. Titel "Create runs on LU Cloud", Text, Knopf "Turn on Cloud" oder "Sign in to LU Cloud" (K1.24), "See what you can make" (K1.25, oeffnet K13). Ist der Schalter "Show Cloud features" aus, steht nur ein Satz und der Verweis auf Settings.
- Leer: bei Image, Video und Music eine Zeile mit Symbol und Satz; bei den anderen Werkzeugen sagen die Karten, was fehlt. Eine leere Eingabe ist eine Karte, die als Ganzes der Knopf ist (kleine Kachel, Titel, Satz, Plus).
- Laeuft: Phase und Uhr ("Rendering · 0:07 · usually 12 s"), Balken, K1.20. Der Auftrag ueberlebt Hintergrund und Neustart; beim Oeffnen steht "Picked up 1 running job."
- Fertig: Ergebnis mit Aktionsreihe.
- Fehler des Auftrags: Kasten "This run failed. You were not charged." mit Grund in einem Satz und "Try again".
- Prompt gesperrt: Kasten unter dem Feld "This prompt cannot be sent." mit dem Grund.
- Kein Netz: G7, "Create" ist gesperrt mit dem Zusatz "No internet".
- Guthaben reicht nicht: Preis wird rot, Tippen auf "Create" oeffnet G5.
- Bezahlung offen: Kasten "Your last payment failed." mit "Pay open invoice".

**K2 Tools** (Blatt): Raster aller zwoelf Werkzeuge mit Symbol und vollem Namen. K2.1 Werkzeug-Kachel (Radio): waehlt und schliesst. K2.2 "Close".

**K3 Model** (Blatt, Create)
Elemente: K3.1 Suchfeld, K3.2 Modellzeile (Radio) mit Familienkopf, Marken und Preis rechts in Mono, K3.3 "Price details" je Zeile (Unterseite: Preis je Bild oder Sekunde, bei Studio-Modellen vom Server bestaetigt), K3.4 "Close".
Zustaende: Katalog laedt, Katalog nicht erreichbar, Suche leer, wie C3.

**K4 Run settings** (Blatt mit Unterseiten)
Elemente: K4.1 Segment "Aspect", K4.2 Segment "Quality", K4.3 Segment "Images" 1 bis 4, K4.4 "Size" oder "Length" (je nach Modell), K4.5 Schalter "Improve my prompt", K4.6 "Negative prompt" (Unterseite Textfeld), K4.7 "Prompt history" (Unterseite: Liste, Tippen setzt den Prompt, "Remove" je Zeile, "Clear all" mit Rueckfrage), K4.8 "Model settings" (nur Studio-Modelle: Unterseite mit Reglern aus dem Schema des Anbieters, je Regler die passende Handyform: Schalter, Segment, Schieber, Zahlenfeld, Auswahlblatt), K4.9 "Save as preset", K4.10 "Close". Die Fusszeile zeigt immer "This run" und den Preis.
Zustaende: Preis wird berechnet ("Checking price"), Preis nicht verfuegbar ("Price could not be confirmed. Try again." und Create bleibt gesperrt).

**K5 Add source** (Blatt)
Elemente: K5.1 "Take photo", K5.2 "Photo library" (Mehrfachauswahl bis 50 startet Batch), K5.3 "File", K5.4 "From gallery" (oeffnet K6 als Auswahl), K5.5 "Saved characters" (Unterseite, Auswahl), K5.6 "Close".

**K6 Gallery** (`/create/gallery`)
Aufbau: Filter-Chips All, Images, Video, Audio. Raster mit drei Spalten ab 320 pt.
Elemente: K6.1 Filter-Chip, K6.2 Kachel (oeffnet K7), K6.3 "Select" (Mehrfachauswahl mit "Delete" und "Save"), K6.4 Im Auswahlmodus "Use" (liefert die Kachel an den Aufrufer zurueck).
Zustaende: Leer "Nothing here yet. Your results show up here." Abgelaufene Adresse: Kachel zeigt "Refreshing", danach das Bild. Endgueltig abgelaufen: Kachel "Expired" mit "Remove".

**K7 Ergebnisansicht** (Vollbild)
Elemente: K7.1 "Close", K7.2 "More" (oeffnet K8), K7.3 "Save", K7.4 "Share", K7.5 Zoom, K7.6 Wischen zum Nachbarn, K7.7 Wiedergabe (Video, Ton) mit Zeitleiste, K7.8 "Enhance video" (nur Cloud-Clips: Unterseite 1080p, 4K mit Preis), K7.9 "Prompt" (klappt den Prompt auf, "Copy").

**K8 Ergebnis-Aktionen** (Blatt)
Elemente: K8.1 "Edit with mask" (K9), K8.2 "Enhance", K8.3 "Remove background", K8.4 "Animate", K8.5 "Extend" (nur Video), K8.6 "Save as character" (aus Videobildern: Unterseite waehlt bis 5 Bilder, Name, "Save"), K8.7 "Use as source", K8.8 "Delete" (Rueckfrage G3), K8.9 "Close".

**K9 Paint the area** (Vollbild, Maskeneditor)
Aufbau: Bild fuellt den Schirm, unten eine Werkzeugleiste. Malen mit einem Finger, Verschieben und Zoomen mit zwei Fingern.
Elemente: K9.1 "Cancel" (Rueckfrage bei gemalter Maske), K9.2 "Done", K9.3 "Brush" / "Eraser" (Segment), K9.4 Pinselgroesse (Schieber), K9.5 "Undo", K9.6 "Clear".
Zustaende: Leere Maske bei Erase: "Done" ist gesperrt mit dem Zusatz "Paint the object first".

**K10 Characters** (`/create/characters`) und **K11 New character** (`/create/characters/new`)
K10 Elemente: K10.1 Charakter-Karte (waehlt ihn fuer den naechsten Lauf und kehrt zu K1 zurueck), K10.2 "More" je Karte ("Rename", "Delete"), K10.3 "New character" (K11), K10.4 Karte eines laufenden Trainings (Fortschritt, "Cancel").
K11 Elemente: K11.1 Feld "Name", K11.2 "Add photos" (Fotoauswahl, 10 bis 20), K11.3 X je Foto, K11.4 "Train, 400 credits" (Hauptknopf, nennt den Preis), K11.5 Hinweis zum Hochladen ueber Mobilfunk mit Schalter "Wait for Wi-Fi".
Zustaende: Zu wenige Fotos ("Add at least 10 photos"), Hochladen (Balken je Foto, haelt bei Netzverlust an und setzt fort), Training laeuft (ueberlebt Neustart), Training gescheitert ("Training failed. You were not charged." und "Try again"), Trainings aufgebraucht (G5 mit Grund trainings).

**K12 Presets** (`/create/presets`): K12.1 Preset-Karte (wendet an und kehrt zurueck), K12.2 "New preset" (Formular: Name, Prompt-Baustein, Werte), K12.3 "Edit", K12.4 "Delete".

**K13 What you can make** (`/create/showcase`): rollbare Seite mit je einem Beispiel pro Werkzeug (Standbild, zwei Zeilen Text). K13.1 "Turn on Cloud" oder "Sign in", K13.2 "See plans" (E3).

**K14 Batch** (`/create/batch`): Liste der Quellbilder mit Zustand je Zeile. K14.1 "Add more", K14.2 X je Zeile, K14.3 "Start, 48 credits" (nennt den Gesamtpreis), K14.4 "Stop after this one", K14.5 Ergebniszeile (oeffnet K7).

### 4.5 Models

**M1 Models** (`/models`, Wurzel)
Zweck: Lokale Chatmodelle finden, laden, verwalten.
Aufbau: Titel "Models", rechts "Downloads" mit Zaehler. Segment "Get new" / "Installed".
Get new: Suchfeld, Filter-Chips, Geraetezeile, Modellkarten. Installed: Speicherkarte, Karten der installierten Modelle, Gruppe mit Benchmark und Aufraeumen.
Modellkarte: Name, Groesse und Quantisierung in Mono, Marken (Vision, Tools, No refusals), Passt-Anzeige, darunter genau eine Aktion.
Passt-Anzeige, dieselbe Formel wie die Sperre der Engine, gerechnet gegen den verfuegbaren Speicher:

| Stufe | Punkt | Text | Aktion |
|---|---|---|---|
| passt | gruen | "Runs well on this phone" | "Download 2.5 GB" |
| knapp | blau | "Tight fit, may be slow" | "Download 4.9 GB", davor Hinweis im Blatt "This model is close to the limit. Other apps may be closed while it runs." |
| zu gross | rot | "Too large for this phone" | kein Download, ein Satz mit dem Grund, Karte fuehrt zu M2 |
| unbekannt | grau | "Size unknown" | "Download", Pruefung vor dem Start |

Elemente:
- M1.1 "Downloads" (Name "Downloads, 1 active"): oeffnet M3.
- M1.2 Segment "Get new" / "Installed".
- M1.3 Suchfeld "Search Hugging Face": sucht GGUF-Repos, Treffer erscheinen als Karten mit Passt-Anzeige.
- M1.4 Filter-Chips "Fits this phone" (Vorgabe an), "Mainstream", "Unfiltered", "Vision".
- M1.5 Modellkarte antippen: oeffnet M2.
- M1.6 "Download <Groesse>": prueft Speicher (G9), startet, die Karte zeigt Fortschritt.
- M1.7 "Pause" / "Resume" an der Karte.
- M1.8 "Cancel" an der Karte: bricht ab, die Teildatei wird entfernt, kein Fehler.
- M1.9 "Use in chat" (installiert): setzt das aktive Modell, Toast "<Name> is now the chat model". Der Toast traegt seit Runde 6 die Aktion "New chat" (oeffnet einen neuen Chat mit diesem Modell), nicht waehrend des Onboardings.
- M1.10 "Benchmark": oeffnet M4.
- M1.11 "Clean up partial downloads" (Zusatz nennt die Groesse): Rueckfrage, dann Loeschen.
- M1.12 Speicherkarte: oeffnet E14.
Zustaende: Katalog laedt (Skelettkarten). Kein Netz: Get new zeigt "No internet. Installed models still work." und "Try again"; Installed bleibt nutzbar. Suche ohne Treffer. Keine installierten Modelle: "No model on this phone yet." mit "Get new". Der fruehere Hinweis "Below 7B" entfaellt; stattdessen steht einmal ueber der Liste: "Models that fit a phone are small. For long or tricky tasks LU Cloud is stronger."

**M2 Modell-Detail** (`/models/:id`)
Aufbau: Passt-Anzeige mit Erklaerung in ganzen Saetzen, Hauptaktion, Varianten (Quantisierungen als Radioliste mit je eigener Passt-Anzeige), Details.
Elemente: M2.1 Variante (Radio), M2.2 "Download" / "Pause" / "Resume" / "Cancel", M2.3 "Use in chat", M2.4 "Delete model" (Rueckfrage G3, nennt die freiwerdende Groesse, loescht alle Teile und die Vision-Datei), M2.5 "Run benchmark" (M4), M2.6 "View on Hugging Face" (Systembrowser), M2.7 "Pick a smaller model" (zurueck zu M1 mit Filter), M2.8 "Use it on LU Cloud" (G11 oder E3).
Details als Zeilen: File size, Memory needed, Context window ("8K on this phone", der wirklich geladene Wert), Vision ("Reads images, adds 0.6 GB"), Source, Checksum ("Verified").
Zustaende: zu gross (siehe 5.3), Download laeuft, Pruefsumme stimmt nicht ("The file was damaged on the way. LU removed it." und "Download again"), Repo gesperrt ("This model needs a Hugging Face token." und "Add token" nach E14).

**M3 Downloads** (`/models/downloads`)
Elemente: M3.1 "Pause" / "Resume", M3.2 "Cancel", M3.3 "Remove" (bei Fehler), M3.4 "Retry", M3.5 Zeile antippen (M2).
Zustaende je Zeile: wartet ("Waiting"), laeuft (Prozent, Groesse, Tempo, Restzeit als Schaetzung), angehalten, wartet auf Netz ("Waiting for network", setzt selbst fort), pruefen ("Verifying"), fertig ("Installed", verschwindet nach 5 s), unterbrochen (siehe 5.4). Leer: "No downloads". Fusssatz: "Downloads keep running when you leave LU and pick up again after a restart."

**M4 Benchmark** (`/models/benchmark`)
Elemente: M4.1 Modellwahl (nur installierte), M4.2 "Run benchmark", M4.3 "Stop", M4.4 Ergebniszeile (klappt Einzelwerte auf), M4.5 "Clear results".
Zustaende: Laeuft (Fortschritt, "Keep LU open"). Ergebnis: Tokens pro Sekunde und Trefferquote, gekennzeichnet als "Measured on this phone". Ein anderes Modell als das geladene wird vorher geladen, die Seite sagt das.

### 4.6 Settings

**E1 Settings** (`/settings`, Wurzel)
Aufbau: Kontokarte oben, darunter Gruppen. Jede Zeile hat Symbol, Name, den aktuellen Wert als Zusatz und fuehrt auf eine Seite.

| Gruppe | Zeilen (Element) | Ziel |
|---|---|---|
| (ohne) | E1.1 Kontokarte: E-Mail, Tarif, Guthabenbalken, oder "Sign in to LU Cloud" | E2 |
| App | E1.2 Appearance, E1.3 Chat defaults, E1.4 Personas, E1.5 Memory, E1.6 Voice | E4, E5, E6, E7, E11 |
| Agent | E1.7 Agent and permissions, E1.8 Web search, E1.9 Workflows | E8, E9, E10 |
| Models and connections | E1.10 On device engine, E1.11 Providers, E1.12 Remote desktop, E1.13 Storage and downloads | E13, E12, E15, E14 |
| Data | E1.14 Backup and import, E1.15 Privacy, E1.16 Content policy | E16, E17, E18 |
| Help | E1.17 Troubleshooting, E1.18 About LU | E19, E20 |

**E2 Account** (`/settings/account`)
Abgemeldet. Elemente: E2.1 Segment "Sign in" / "Create account", E2.2 Feld "Email", E2.3 Feld "Password" mit "Show", E2.4 "Sign in" oder "Create account", E2.5 "Continue with Google", E2.6 "Continue with GitHub" (beide oeffnen den Systembrowser, die Rueckkehr kommt als Angebot per App-Link), E2.15 "Sign in with Apple" (nur iOS, steht ueber E2.5 und E2.6, Blatt des Systems statt Browser, Farben nach Apples Vorgabe: weiss im dunklen, schwarz im hellen Design; darunter der Satz "Use the same sign-in you used before to reach your existing account."), E2.7 "Forgot password?" (oeffnet lu-labs.ai im Browser), E2.8 "What is LU Cloud?" (E3).
Angemeldet. Aufbau: Karte mit E-Mail, Tarif, Verlaengerung, Guthabenbalken "Cloud credits this period". Elemente: E2.9 "Manage subscription" oder "View plans" (Systembrowser), E2.10 "Pay open invoice" (nur bei gescheiterter Zahlung, mit rotem Kasten "Your last payment failed"), E2.11 "Sync memories" (E7), E2.12 "Content policy" (E18), E2.13 "API keys" (Absatz und Link "Open account on lu-labs.ai"), E2.14 "Sign out" (Rueckfrage; bei nicht abgeglichenen Erinnerungen mit "Sync, then sign out").
Zustaende: Pruefung laeuft ("Checking your account"), falsches Passwort ("Email or password is not correct."), kein Netz, Bestaetigungsmail offen ("Check your inbox to confirm your email."), Sitzung abgelaufen (G6).

**E3 LU Cloud** (`/cloud`)
Zweck: Tor vor der Cloud und Verkaufsblatt.
Aufbau (seit Runde 51, Plan `mobile-docs/plaene/LU-CLOUD-SEITE.md`): Titel nur in der Kopfzeile. Oben das Zahlband: kleines Monogramm, die Gesamtzahl gross, "AI models on LU Cloud", darunter klein die Teile Chat, Bild, Video (`screens/settings/parts/cloud-counts.ts`, eine Zaehlregel; App Store ohne Zahl vor der Anmeldung, angemeldet die gezaehlte sichtbare Liste). Im Verkaufsfall darunter der Schaukasten (Segment Chat, Image, Video, drei bewegte Szenen, Ausnahme D5 in Abschnitt 9), zwei Nutzenzeilen und der Paketteil: open drei kompakte Tarifzeilen, play der eine Kaufsatz ohne Link, appstore nichts. "Not now" ruhig am Ende des Inhalts. Der eine gefuellte Hauptknopf jedes Zustands steht in der festen Fusszeile, daneben hoechstens ein zweiter ohne Fuellung.
Elemente: E3.1 "Get LU Cloud" bzw. "See plans" (open, oeffnet das Blatt "Choose a plan" mit den drei Tarifzeilen, jede Zeile oeffnet `/checkout/start` im Systembrowser; dieselben Zeilen stehen auf der Seite), E3.2 "Sign in" (E2; Hauptknopf im App-Store-Paket), E3.3 "I already subscribed, check again" (liest `/api/me` neu), E3.4 "Pay open invoice", E3.5 "Not now", E3.6 "Create account" (nur play, Hauptknopf; oeffnet E2 auf dem Segment "Create account").
Zustaende: abgemeldet, angemeldet ohne Abo, Zahlung offen, Pruefung laeuft, Abo erkannt ("You're in. Cloud is ready." und "Turn on Cloud").

**E4 Appearance**: E4.1 Segment Theme "System" / "Dark" / "Light", E4.2 "Profile picture" (Fotoauswahl, "Remove"), E4.3 Schalter "Show Cloud features while on device" (Ausschalten zeigt einmal den Hinweis, wo man es wieder einschaltet). Satz: "Text size follows your phone settings."

**E5 Chat defaults**: E5.1 Schieber "Temperature", E5.2 "Top P", E5.3 "Top K", E5.4 "Max length", E5.5 Zahlenfeld "Compact automatically at" (Prozent), E5.6 Schalter "Read every answer aloud" (nur Cloud), E5.7 "Reset chat defaults" (Rueckfrage).

**E6 Personas**: E6.1 Schalter "Use personas", E6.2 Persona-Karte (Radio, setzt die aktive Persona), E6.3 "Edit" je Karte (Editor-Seite), E6.4 "New persona", Editor: E6.5 Feld "Name", E6.6 Feld "Instructions" (grosses Textfeld), E6.7 "Save", E6.8 "Delete persona" (Rueckfrage), E6.9 "Reset built in personas".
Zustaende: Ungesicherte Aenderung beim Zurueck: G3 "Discard changes?".

**E7 Memory**: Aufbau: Suchfeld, Kategorie-Chips, Liste, Gruppe Einstellungen, Gruppe Sync.
Elemente: E7.1 Suchfeld, E7.2 Kategorie-Chip, E7.3 Erinnerungszeile (Detailseite mit Text, Kategorie, Projekt, "Save", "Delete"), E7.4 "Add memory", E7.5 Schalter "Learn from chats" (stiller Zusatzaufruf, Zusatz "Uses a little battery"), E7.6 Schalter "Also outside Agent mode", E7.7 Zahlenfeld "Keep at most", E7.8 "Review old memories" (gefilterte Liste), E7.9 "Sync with account" (Zustand und "Sync now"), E7.10 Konfliktblatt "Keep this phone" / "Keep account" / "Keep both", E7.11 "Bring over older memories", E7.12 "Export" (Markdown oder JSON, Teilen-Blatt), E7.13 "Import" (Dokumentauswahl), E7.14 "Delete all memories" (Rueckfrage mit Eingabe des Wortes DELETE).
Zustaende: leer, Sync laeuft, Sync gescheitert ("Could not sync. Your memories are safe on this phone." und "Try again"), abgemeldet (Sync-Gruppe zeigt "Sign in to sync").

**E8 Agent and permissions**: E8.1 je Werkzeuggruppe (Web, Files in chat, Memory, Workflows, Sub agents) ein Segment "Blocked" / "Ask" / "Auto", E8.2 Zahlenfeld "Sub agent tool calls", E8.3 Zahlenfeld "Sub agent steps", E8.4 "Show the Agent mode intro again", E8.5 "Reset permissions" (Rueckfrage).
Die Gruppen Terminal, Desktop, Image und Video gibt es hier nicht.

**E9 Web search**: E9.1 Radioliste "Auto" / "DuckDuckGo" / "Brave" / "Tavily", E9.2 Feld "Brave API key", E9.3 Feld "Tavily API key" (beide im Schluesselbund, "Paste" und "Remove"), E9.4 "Test search".

**E10 Workflows**: E10.1 Workflow-Zeile (Detail), E10.2 "New workflow", E10.3 "Run in a new chat". Baukasten: E10.4 Feld "Name", E10.5 Schrittkarte (antippen oeffnet das Schrittformular als Seite), E10.6 "Add step" (Blatt mit sechs Schrittarten), E10.7 "Move up" / "Move down" je Schritt (keine Ziehgeste noetig), E10.8 "Remove step", E10.9 "Save", E10.10 "Delete workflow". Der eingebaute Workflow Code Review wird nicht gezeigt.

**E11 Voice**: E11.1 Radioliste "Cloud voice" mit "Preview" je Stimme, E11.2 Schieber "Speed", E11.3 Schieber "Pitch", E11.4 Schalter "Read every answer aloud", E11.5 Schalter "Use the system voice when Cloud is off" (nur wenn der WebView eine Stimme hat). Satz: "Dictation and Cloud voice use credits. A fixed amount per request."
Zustaende: abgemeldet ("Sign in to use voice"), Vorschau laedt, Mikrofon verweigert (Kasten mit "Open system settings").

**E12 Providers**: Liste: "On device engine" (fuehrt zu E13), "LU Cloud" (fuehrt zu E2), darunter die gehosteten Anbieter (OpenRouter, Groq, Together, DeepSeek, Mistral, OpenAI, Anthropic) und "Custom endpoint".
Elemente Liste: E12.1 Anbieterzeile mit Zustand. Detailseite: E12.2 Schalter "Use this provider", E12.3 Feld "API key" (Schluesselbund, "Paste", "Remove"), E12.4 Feld "Base URL" (nur Custom, mit Hinweis "Must start with https, or be a device on your network"), E12.5 "Test connection" (Ergebnis in Worten und Zahl der Modelle), E12.6 "Remove provider".
Zustaende: Schluessel fehlt, Pruefung laeuft, Pruefung gescheitert (Grund in einem Satz).

**E13 On device engine**: E13.1 Zustandskarte (geladenes Modell, GPU oder CPU, geladenes Kontextfenster), E13.2 "Unload model", E13.3 Segment "Context" (nur Werte unter dem Geraetedeckel), E13.4 Schalter "Use graphics acceleration", E13.5 Zahlenfeld "Threads", E13.6 Schalter "Keep model in memory" (mlock), E13.7 Schalter "Unload when LU is in the background", E13.8 "Advanced" (Unterseite: Flash attention, Cache types, GPU layers, mmap), E13.9 "Reset engine settings".
Zustaende: kein Modell geladen, Engine laeuft auf CPU nach Ausfall der Beschleunigung (Hinweiskasten in der Variante warn, ruhiges Grau, siehe G10), Start gescheitert (roter Kasten mit Grund und "Try again").

**E14 Storage and downloads**: E14.1 Speicherbalken (Models, Chats and files, Free), E14.2 Zeile je installiertem Modell mit "Delete", E14.3 "Clean up partial downloads", E14.4 Auswahl "Download speed limit" (Off, 1, 5, 10 MB/s), E14.5 Schalter "Download on Wi-Fi only", E14.6 Feld "Hugging Face token" (Schluesselbund), E14.7 "Clear cached results" (Galerie-Vorschauen).

**E15 Remote desktop**: Zustand der Verbindung, E15.1 "Connect" (R1) oder "Disconnect", E15.2 "How it works" (R5), E15.3 "Forget this desktop".

**E16 Backup and import**: E16.1 "Back up all chats" (Teilen-Blatt mit der Datei), E16.2 "Restore from a backup file" (Dokumentauswahl, danach Zusammenfassung "42 chats found" und "Restore"), E16.3 "Import from ChatGPT, Claude or Gemini" (Seite: Datei waehlen, Fortschritt, Ergebnis "128 chats imported", Schalter "Make them searchable in chat"), E16.4 Anzeige "Automatic backup: today, 14:02" mit "Back up now", E16.5 "Delete all chats" (Rueckfrage mit Eingabe).
Zustaende: Datei nicht lesbar, Import laeuft (Abbrechen moeglich), zu grosse Datei ("This export is very large. Keep LU open until it is done.").

**E17 Privacy**: Text, neu fuer das Handy geschrieben (was auf dem Geraet bleibt, was bei Cloud gesendet wird, der anonyme Zaehler am Cloud-Schalter, die Sicherung im App-Ordner). E17.1 Schalter "Send anonymous switch count", E17.2 "Open privacy policy" (Systembrowser).

**E18 Content policy**: E18.1 Radioliste "Strict" / "Standard" / "Off" mit je einem Satz. Zustaende: abgemeldet ("Sign in to change this"), Speichern laeuft, Speichern gescheitert.

**E19 Troubleshooting**: Aufbau: drei Pruefzeilen mit Ampel und Satz: On device engine, Internet, LU Cloud. Elemente: E19.1 "Run checks again", E19.2 "Share log" (Teilen-Blatt mit der Logdatei), E19.3 "Copy details" (Version, Geraet, Speicher), E19.4 "Run setup again" (startet A1 neu, vorhandene Modelle werden erkannt), E19.5 "Reset all settings" (Rueckfrage; Chats bleiben).

**E20 About LU**: Version und Build in Mono, E20.1 "What is new" (E21), E20.2 "Licenses", E20.3 "Website" (Systembrowser), E20.4 Version antippen kopiert sie.

**E21 What is new**: eigene Texte fuer die Handyfassung, einmal je Version von selbst als Seite, danach ueber E20.1. Element: E21.1 "Got it".

### 4.7 Globale Bausteine

- **G1 Reiterleiste.** G1.1 bis G1.4 Reiter Chat, Create, Models, Settings (Rolle tab).
- **G2 Toast.** Ein Satz, 3 Sekunden, ueber der Reiterleiste oder dem Eingabefeld. Hoechstens eine Aktion ("Undo"). Bleibt stehen, solange ein Systemblatt (Teilen) offen ist, und zaehlt erst danach.
- **G3 Rueckfrage-Dialog.** Titel als Frage, ein Satz zur Folge, zerstoerender Knopf oben in Rot, "Keep" oder "Cancel" darunter. Erscheint mittig unter dem Finger, verfaellt nicht von selbst, Zurueck bedeutet Abbrechen.
- **G4 Fehlerschirm.** Ersetzt die Shell, wenn sie nicht starten kann. "LU could not start." Ein Satz Grund. G4.1 "Try again", G4.2 "Restore from backup", G4.3 "Share log", G4.4 "Reset settings and restart".
- **G5 Guthaben leer** (Blatt), siehe 5.6.
- **G6 Sitzung abgelaufen** (Blatt), siehe 5.7.
- **G7 Offline-Zeile.** Schmale Zeile unter der Kopfzeile jeder Seite, die Netz braucht: "No internet. On device models still work." Verschwindet von selbst.
- **G8 Hinweis nach Beenden durch das System**, siehe 5.5. Kasten in der Variante warn: ruhiges Grau (`--m-warn`, `--m-warn-soft`) mit Warnsymbol, kein Gelb.
- **G9 Speicher voll** (Dialog), siehe 5.2.
- **G10 Engine-Hinweise** (Zeile im Hinweisbereich von C2 und Kasten in E13): "Loading <Modell>", "Graphics acceleration is not available. LU is running on the processor, which is slower." mit "Details", "The model was unloaded to free memory." mit "Load again", "The model could not start." mit Grund und "Try again". Die Hinweise zur Beschleunigung und zum Entladen stehen in der Variante warn (ruhiges Grau mit Warnsymbol, kein Gelb), der gescheiterte Start in der Variante error.
- **G11 Wechsel in die Cloud** (Dialog): "Switch to Cloud?" "Chat, Create and voice then run on LU hosted GPUs. Answers are billed to your lu-labs.ai credits." G11.1 "Switch to Cloud", G11.2 "Stay on device".
- **G12 Speicher der App voll** (Toast mit Aktion): "LU is running out of space for chats." mit "Manage storage" (E14).
- **G13 Preis dieser Runde** (Blatt): Flash-Hinweis ("This model is free today, 14 of 50 answers used" oder "This answer uses about 2 credits"), G13.1 "Change model", G13.2 "Close".
- **G14 Angebot aus einem App-Link** (Blatt): "Finish signing in?" oder "Connect to <Adresse>?" mit "Continue" und "Dismiss". Verfaellt nach 5 Minuten.

## 5. Fehlerfaelle aus Abschnitt 3 Punkt 4 des Ziels

Jeder Fall hat einen entworfenen Zustand. Muster: was ist passiert, was ist gerettet, was jetzt. Der Text des Nutzers bleibt immer im Feld. Belege im Prototyp: `mock/shots/*--err-*.png`.

### 5.1 Kein Netz, oder das Netz bricht mitten im Stream ab

| Ort | Zustand | Text | Aktionen |
|---|---|---|---|
| jede Seite mit Netzbedarf | Zeile G7 unter der Kopfzeile | "No internet. On device models still work." | keine, verschwindet von selbst |
| C2, Senden an ein Cloud-Modell ohne Netz | Kasten ueber dem Feld, nichts wird gesendet | "No internet. Your message is kept." | "Try again", "Use an on device model" (C3) |
| C2, Abbruch im Stream | roter Kasten unter der halben Antwort, die Antwort bleibt stehen und ist gespeichert | "Connection lost. The answer stopped here. What arrived is saved in this chat." | "Try again" (setzt neu an), "Use an on device model" |
| C2, lokales Modell | kein Fehler, lokaler Chat braucht kein Netz | | |
| K1, laufender Auftrag | Wartebild bleibt, Zusatzzeile | "Still rendering on LU Cloud. LU fetches the result when you are back online." | "Cancel and refund" bleibt |
| K1, vor dem Start | "Create" gesperrt mit Zusatz | "No internet" | |
| M1 Get new | leerer Zustand | "No internet. Installed models still work." | "Try again" |
| M3, laufender Download | Zeile wechselt auf Warten, kein Fehler | "Waiting for network" | "Pause", "Cancel" |
| E2 Anmelden | Text unter dem Knopf | "No internet. Try again when you are connected." | |
| R4 | roter Kasten | "Connection to your desktop was lost." | "Reconnect" |
| Werkzeug Websuche im Agenten | Werkzeugzeile mit Fehlerzeichen, der Lauf geht weiter | "web_search failed: no internet" | aufklappen |

### 5.2 Speicher voll

| Ort | Zustand | Text | Aktionen |
|---|---|---|---|
| vor jedem Download (A2, M1, M2, C8.6) | Dialog G9, der Download startet nicht | "Not enough storage. Llama 3.1 8B needs 4.9 GB. This phone has 1.1 GB free. Free up 3.8 GB, then start the download again." | "Manage installed models" (M1 Installed), "Close" |
| M3, Speicher laeuft waehrend des Downloads aus | Zeile unterbrochen, Teildatei bleibt | "Storage ran out at 71%. Free up 1.4 GB to continue." | "Manage storage" (E14), "Resume", "Remove" |
| ueberall, Speicher der App fuer Chats voll | Toast G12, die letzte Nachricht ist noch gesichert | "LU is running out of space for chats." | "Manage storage" |
| C4, Anhang | Toast | "Not enough storage to attach this file." | |
| K1.13, Sichern in Fotos | Toast | "Could not save. Your phone is out of storage." | "Share" bleibt moeglich |

### 5.3 Modell zu gross fuer das Geraet

| Ort | Zustand | Text | Aktionen |
|---|---|---|---|
| A2, M1 | Karte mit roter Passt-Anzeige, kein Download-Knopf | "Too large for this phone" und "Needs about 9 GB of memory. This phone has 8 GB." | Karte fuehrt zu M2 |
| M2 | Erklaerung in ganzen Saetzen | "This model needs about 9 GB of memory while it runs. This phone has 8 GB, and about 5.1 GB can go to a model. LU will not download it, so you do not lose 7.5 GB on something that cannot start." | "Pick a smaller model", "Use it on LU Cloud" |
| M1.3, Treffer der Suche | Passt-Anzeige je Treffer, zu grosse Varianten in M2 nicht waehlbar | wie oben | |
| C2, ein installiertes Modell laesst sich nicht laden (anderes Geraet nach Wiederherstellung, wenig freier Speicher) | Kasten im Hinweisbereich G10 | "Not enough free memory to load Llama 3.1 8B right now." | "Try again", "Pick another model" (C3) |
| C13, C9 | Hinweis statt Fehler | "This phone holds one model at a time." | |

### 5.4 Download abgebrochen

| Ort | Zustand | Text | Aktionen |
|---|---|---|---|
| M3, M1-Karte, A2 | roter Kasten in der Zeile, Teildatei bleibt | "Download interrupted. Stopped at 38%. The part that arrived is kept, so you will not start over." | "Resume", "Remove" |
| Abbruch durch den Nutzer | kein Fehler, die Zeile verschwindet | Toast "Download cancelled" | |
| Pruefsumme falsch | roter Kasten | "The file was damaged on the way. LU removed it." | "Download again" |
| Quelle nicht erreichbar oder gesperrt | roter Kasten | "Hugging Face did not answer. Try again in a moment." oder "This model needs a Hugging Face token." | "Retry", "Add token" |
| nach App-Neustart | Download laeuft weiter oder steht als angehalten in M3; Punkt am Reiter Models | "Resumed after restart" in der Zeile | "Pause", "Cancel" |

### 5.5 App im Hintergrund vom System beendet

| Was lief | Zustand beim naechsten Start | Text | Aktionen |
|---|---|---|---|
| Antwort im Chat | Die App oeffnet denselben Chat. Die halbe Antwort steht da, darunter ein Hinweiskasten G8 (Variante warn, ruhiges Grau mit Warnsymbol) | "LU was closed while answering. Your phone needed the memory. The answer is saved up to this point and the model has been loaded again." | "Continue answer", "Dismiss" |
| getippter, nicht gesendeter Text | steht wieder im Eingabefeld | | |
| Agent, Unter-Agent, `/loop` | Lauf steht als angehalten im Hinweisbereich | "Paused when LU was closed." | "Continue", "Stop" |
| Download | laeuft ueber den Systemdienst weiter | siehe 5.4 | |
| Cloud-Auftrag in Create | wird wiedergefunden | "Picked up 1 running job." | |
| Dokument wird indexiert | Zeile in C8 | "Paused. Open LU to continue." | "Continue" |
| nichts | normaler Start am letzten Ort | | |

Beim Wechsel in den Hintergrund ohne Beenden: der lokale Lauf wird angehalten und gespeichert, bei Rueckkehr "Paused while LU was in the background." mit "Continue". Bei einer Speicherwarnung des Systems wird das Modell entladen (G10 "The model was unloaded to free memory." mit "Load again").

### 5.6 Guthaben leer (G5, Blatt)

Titel je Grund: "You're out of credits", "This month's video budget is used up", "Top up to keep training". Text aus `lib/credits-exhausted.ts`, dazu der Satz "Your message is kept in the box. On device models still work and cost nothing."
Elemente: G5.1 "See plans and packs" (Systembrowser), G5.2 "Switch to an on device model" (C3, nur im Chat), G5.3 "Not now".
Das Blatt erscheint dort, wo der bezahlte Aufruf scheitert (C2, K1, K11, C2.7, C2.18), nie beim blossen Oeffnen der App. Der Guthaben-Chip K1.1 und die Kontokarte E1.1 zeigen den leeren Balken dauerhaft.

### 5.7 Sitzung abgelaufen (G6, Blatt)

Titel "Please sign in again". Text "Your LU Cloud session has expired. Sign in again to keep using Cloud models, Create and voice." und "Chats and models on this phone are untouched. Your message is kept in the box."
Elemente: G6.1 "Sign in" (E2, danach zurueck an denselben Ort, die Aktion wird nicht still wiederholt), G6.2 "Continue on device" (schaltet auf lokal und oeffnet C3).
Die App versucht vorher still, das Token zu erneuern. Erst wenn das scheitert, kommt das Blatt. Ein einzelner Start ohne Netz macht aus Cloud nicht dauerhaft Lokal.

## 6. Zuordnung der Funktionsinventur

Alle 173 Zeilen mit dem Urteil `uebernehmen` (130) oder `nur Cloud` (43), erzeugt per Skript aus `mobile-docs/INVENTUR-FUNKTIONEN.md` und gegen die Zuordnung geprueft: keine Zeile fehlt, keine ist doppelt. Die Nummer ist Abschnitt und Zeile der Inventur (alle Zeilen gezaehlt, auch `weglassen`).

| Nr. | Funktion (Inventur) | Urteil | Screens | Elemente und Anmerkung |
|---|---|---|---|---|
| 1.1 | Textchat mit lokalem Modell, Antwort als Stream | uebernehmen | C2 | C2.3, C2.8, Stream im Verlauf |
| 1.2 | Textchat ueber LU Cloud Modelle | nur Cloud | C2, C3 | C3.7 waehlt das Cloud-Modell, Chip C2.13 |
| 1.3 | Chat ueber fremde gehostete Anbieter mit eigenem API-Schluessel (OpenRouter, Groq, Together, DeepSeek, Mistral, OpenAI, Anthropic) | uebernehmen | E12, C3 | E12.2 bis E12.5, Modelle in C3.11 |
| 1.6 | Eigener OpenAI-kompatibler Endpunkt mit frei eingetragener Adresse | uebernehmen | E12 | Zeile Custom endpoint, E12.4 |
| 1.7 | Modellauswahl lokal (Liste der installierten Modelle, Wechsel laedt das Modell) | uebernehmen | C3 | C3.2 |
| 1.8 | Modellauswahl im Cloud-Modus mit Suche, Familienkoepfen, vier Tags und Preisfrage je Zeile | nur Cloud | C3 | C3.5 bis C3.8, Familienkoepfe als Gruppentitel |
| 1.9 | Im Cloud-Modus wird kein Modell vorgewaehlt, Senden ohne Modell behaelt die Nachricht und oeffnet die Auswahl | nur Cloud | C2, C3 | C2.6 zeigt "Choose a model", C2.8 behaelt den Text |
| 1.10 | Marken "No refusals" und "No credits" an Modellen | nur Cloud | C3, K3 | Marken an C3.7 und K3.2 |
| 1.11 | Flash-Hinweis (kostet diese Runde Guthaben oder nicht, Tagesmenge) | nur Cloud | G13 | ueber Chip C2.13 |
| 1.12 | Nachrichtenaktionen: kopieren, bearbeiten, neu erzeugen, loeschen | uebernehmen | C2, C6 | C2.16 bis C2.19, C6.1 bis C6.7 |
| 1.13 | Markdown mit Mathe und fluessigem Stream | uebernehmen | C2 | Verlauf, wiederverwendeter MarkdownRenderer |
| 1.14 | Codeblock mit Hervorhebung und Kopieren | uebernehmen | C2 | C2.22, waagerechtes Rollen im Block |
| 1.15 | HTML-Vorschau eines Codeblocks im abgeschotteten Rahmen | uebernehmen | C11 | ueber C2.23 |
| 1.16 | Denkblock und Schalter "Thinking" | uebernehmen | C2, C5 | C2.20, C5.2 |
| 1.17 | Denkaufwand umschalten (Reasoning effort) | uebernehmen | C5 | C5.3 |
| 1.18 | Sampling je Chat (Temperatur, Top P, Antwortlaenge) | uebernehmen | C5 | C5.12 |
| 1.19 | Kontextfenster waehlen und Fuellstand anzeigen | uebernehmen | C2, C5 | C2.14, C5.13 |
| 1.20 | Verdichten des Verlaufs: automatisch ab Schwelle und per `/compact`, mit Block im Verlauf | uebernehmen | C2, C5 | C2.25, C5.13 "Compact now", Befehl in C2.3 |
| 1.21 | Bilder anhaengen (bis 5, Vision-Modelle) | uebernehmen | C4, C2 | C4.1, C4.2, Chip C2.15 |
| 1.22 | Beliebige Datei anhaengen (bis 3 je Nachricht, 64 MB) | uebernehmen | C4, C2 | C4.3, Chip C2.15 |
| 1.24 | Datei-Artefakt im Chat mit Vorschau und Download | uebernehmen | C2, C14 | C2.24, C14.2 |
| 1.25 | Chat-Werkzeuge im normalen Chat (Websuche, Seite holen, Datei schreiben), Schalter im Plugins-Menue | uebernehmen | C5 | C5.4, C5.5 |
| 1.27 | Caveman Mode (Off, Lite, Full, Ultra) | uebernehmen | C5 | C5.9 |
| 1.28 | Chatliste: neuer Chat, Suche, umbenennen, loeschen | uebernehmen | C1, C7 | C1.3, C1.6, C7.1, C7.7 |
| 1.29 | Letzte Chats auf dem leeren Startbild | uebernehmen | C1 | Die Liste ist die Startseite; der leere Zustand von C1 und C2 ersetzt das Startbild |
| 1.30 | "Beantwortet von" je Antwort und Hinweis, wenn der Chat auf einem anderen Modell lief | uebernehmen | C2 | Zeile ueber jeder Antwort, Hinweisbereich |
| 1.31 | Hinweis unter einer ablehnenden Antwort mit "New chat" | uebernehmen | C2 | C2.26 |
| 1.32 | Hinweiszeilen ueber dem Verlauf (Engine gewechselt, Start gescheitert, Warteschlange der lokalen Spur) | uebernehmen | C2, G10 | Hinweisbereich von C2 |
| 1.33 | Stop, Laufanzeige mit Uhr, Laeufe je Chat getrennt | uebernehmen | C2, C1 | C2.9, Laufanzeige, Marke "Answering" in C1 |
| 1.34 | A/B Compare: derselbe Prompt an zwei Modelle | uebernehmen | C9 | ueber C7.3 |
| 2.1 | Gruppenchat mit bis zu 4 Modellen je Unterhaltung | uebernehmen | C13 | ueber C5.8 |
| 2.2 | Eigene Persona je Teilnehmer | uebernehmen | C13 | C13.3 |
| 2.3 | Zeilen, die ein Modell im Namen eines anderen schreibt, werden abgeschnitten | uebernehmen | C2 | Textlogik ohne Bedienelement, sichtbar im Verlauf |
| 2.4 | Kostenhinweis vor dem Senden (eine Eingabe, mehrere Antworten) | uebernehmen | C2, C13 | C2.33, C13.4 |
| 3.1 | Persona-Bibliothek mit Hauptschalter "Use personas" und Auswahl der aktiven Persona | uebernehmen | E6 | E6.1, E6.2 |
| 3.2 | Eigene Persona anlegen, bearbeiten, loeschen (Systemprompt-Editor) | uebernehmen | E6 | E6.3 bis E6.8 |
| 3.3 | Persona je Chat ein- und ausschalten | uebernehmen | C5 | C5.7 |
| 3.4 | Grund-Systemprompt der Standard-Persona, gilt in Chat, Agent und Code | uebernehmen | E6 | wirkt in C2 und R4, ohne eigenes Bedienelement |
| 4.1 | Dokumente je Chat hochladen und befragen (PDF, DOCX, TXT) | uebernehmen | C8 | C8.2, Frage in C2 |
| 4.2 | RAG ein und aus, alle Dokumente leeren, einzelnes Dokument entfernen, gefundene Stellen mit Wertung ansehen | uebernehmen | C8 | C8.1, C8.3 bis C8.5 |
| 4.3 | Docs-Knopf mit drei Zustaenden und Satz, wohin der Text geht | uebernehmen | C2, C4, C8 | Chip C2.11 mit drei Zustaenden, Satz in C8 |
| 4.4 | Fehlerzeile "Dokumente wurden fuer diese Nachricht nicht durchsucht" | uebernehmen | C2 | C2.27 |
| 4.5 | Embedding-Modell installieren (im Onboarding und als Karte im RAG-Bereich) | uebernehmen | A3, C8 | A3.2, C8.6 |
| 4.6 | Document Chat mit Cloud-Chatmodell (Embedding bleibt lokal) | uebernehmen | C8, C2 | Satz in C8 nennt LU Cloud als Ziel der Stellen |
| 5.1 | Agent Mode je Chat einschalten, mit Einfuehrung | uebernehmen | C5, C2 | C5.1 mit Einfuehrung, Chip C2.10 |
| 5.2 | Anzeige der Werkzeugaufrufe, Zwischentexte, Band mit mehreren Aufrufen | uebernehmen | C2 | C2.21 |
| 5.3 | Freigabe eines Werkzeugaufrufs (Approve, Reject) | uebernehmen | C12 | C12.1 bis C12.3 |
| 5.4 | Rechte je Werkzeuggruppe (blocked, confirm, auto), global und je Chat | uebernehmen | E8, C5 | E8.1, C5.14 |
| 5.5 | Websuche als Werkzeug (Auto: SearXNG vor DuckDuckGo, sonst Brave oder Tavily) | uebernehmen | C5, E9 | C5.4, E9.1 |
| 5.6 | Seite holen als Werkzeug (`web_fetch`) | uebernehmen | C5 | C5.4 |
| 5.7 | Suchanbieter und Schluessel fuer Brave und Tavily einstellen | uebernehmen | E9 | E9.1 bis E9.4 |
| 5.8 | Dateiwerkzeuge im Arbeitsordner (lesen, schreiben, aendern, auflisten, suchen) | uebernehmen | C5, C7 | C5.5, C7.6 |
| 5.9 | Arbeitsordner je Chat als Sandkasten | uebernehmen | C7 | C7.6, fester Ordner je Chat im App-Speicher |
| 5.14 | Plan des Modells (`todo_write`) als Band ueber dem Verlauf | uebernehmen | C2 | C2.30 |
| 5.15 | Unter-Agenten (`delegate_task`, `check_tasks`, `message_agent`) mit Spalte fuer Hintergrundaufgaben | uebernehmen | C10 | ueber C7.4 |
| 5.16 | Grenzen fuer Unter-Agenten (Werkzeugaufrufe, Schritte) | uebernehmen | E8 | E8.2, E8.3 |
| 5.17 | Small-Model Mode (schlankes Werkzeugprofil fuer kleine Modelle) | uebernehmen | C5 | C5.6 |
| 5.18 | Erkennung, ob ein Modell Werkzeuge kann, mit Hermes-XML als Ausweichweg | uebernehmen | C2, C5 | Warnzeichen am Chip C2.10, Zusatz an C5.1 |
| 5.19 | `/goal` mit Zielzeile ueber dem Eingabefeld | uebernehmen | C2, C5 | C2.28, C5.15, Befehl in C2.3 |
| 5.20 | `/loop` mit Laufzeile und Bremse | uebernehmen | C2, C5 | C2.29, C5.16, Befehl in C2.3 |
| 5.23 | Erinnerungen ansehen, hinzufuegen, loeschen ueber das Gehirn-Symbol | uebernehmen | E7 | ueber C5.10, E7.3, E7.4 |
| 5.24 | Erinnerungen in jeden Prompt einfuegen, Auswahl ueber Embedding oder Stichwort | uebernehmen | E7 | wirkt in C2, Zusatz an C5.10 nennt die Zahl |
| 5.25 | Erinnerungen automatisch aus dem Gespraech ziehen (auch ausserhalb des Agent Mode schaltbar) | uebernehmen | E7 | E7.5, E7.6 |
| 5.26 | Erinnerungsverwaltung (Suche, Kategorien, veraltete Eintraege, Projektzuordnung, Hoechstzahl) | uebernehmen | E7 | E7.1 bis E7.8 |
| 5.27 | Erinnerungen mit dem Konto abgleichen, mit Konfliktwahl und Altbestand | nur Cloud | E7, E2 | E7.9 bis E7.11, E2.11 |
| 8.1 | Diktat: Mikrofonknopf, Aufnahme, Text landet im Eingabefeld | nur Cloud | C2 | C2.7 |
| 8.4 | Vorlesen einer Antwort (Lautsprecherknopf) ueber Cloud-Stimme | nur Cloud | C2, C6 | C2.18, C6.2 |
| 8.5 | Vorlesen ueber die Systemstimme des WebView (Web Speech) als Ausweichweg | uebernehmen | C2, E11 | C2.18 als Ausweichweg, E11.5 |
| 8.8 | Jede fertige Antwort automatisch vorlesen | nur Cloud | E11, E5 | E11.4, E5.6 |
| 8.9 | Spracheinstellungen (Cloud-Stimme, Tempo, Tonhoehe) | nur Cloud | E11 | E11.1 bis E11.3 |
| 10.1 | Create-Flaeche mit Leiste der Werkzeuge | nur Cloud | K1, K2 | K1.3, K1.4, K2.1 |
| 10.2 | Bild erzeugen | nur Cloud | K1 | Werkzeug Image, K1.10 |
| 10.3 | Edit und Image to Image, mit und ohne Maske | nur Cloud | K1, K9 | Werkzeug Edit, K1.18, K9 |
| 10.4 | Hintergrund entfernen | nur Cloud | K1, K8 | Werkzeug Cutout, K8.3 |
| 10.5 | Bild verbessern (Enhance, 2k, 4k, 8k) | nur Cloud | K1, K8 | Werkzeug Enhance, K8.2 |
| 10.6 | Objekt entfernen (Erase) | nur Cloud | K1, K9 | Werkzeug Erase |
| 10.7 | Video aus Text | nur Cloud | K1 | Werkzeug Video |
| 10.8 | Bild animieren | nur Cloud | K1, K8 | Werkzeug Animate, K1.16, K8.4 |
| 10.9 | Character Studio in der Cloud: Fotos sammeln, trainieren, Regal, mit dem Charakter erzeugen | nur Cloud | K10, K11, K1 | K10.1 bis K10.4, K11.1 bis K11.5 |
| 10.10 | Talking Character (Lip Sync) samt Stimme erzeugen und Presenter-Auswahl mit Gesichtern | nur Cloud | K1 | Werkzeug Talking, Karten Presenter und Voice |
| 10.11 | Musik | nur Cloud | K1, K7 | Werkzeug Music, Wiedergabe K7.7 |
| 10.12 | Video verlaengern | nur Cloud | K1, K8 | Werkzeug Extend, K8.5 |
| 10.13 | Motion Control | nur Cloud | K1 | Werkzeug Motion |
| 10.14 | Video verbessern aus der Grossansicht | nur Cloud | K7 | K7.8 |
| 10.15 | Modellwahl in Create mit Preis je Zeile, Familienkoepfen und Marken | nur Cloud | K3 | K3.1 bis K3.3 |
| 10.16 | Guthabenanzeige mit Preis vor dem Start, bei Studio-Modellen vom Server bestaetigt | nur Cloud | K1, K4 | K1.1, K1.6, Fusszeile von K4 |
| 10.17 | Regler eines Studio-Modells aus dem Anbieterschema | nur Cloud | K4 | K4.8 |
| 10.18 | Presets: Schiene und Werkstatt | nur Cloud | K1, K12 | K1.22, K12.1 bis K12.4, K4.9 |
| 10.19 | Bis zu vier Bilder je Lauf | nur Cloud | K4 | K4.3 |
| 10.20 | Mehrere Quellbilder nacheinander bearbeiten (bis 50), Warteschlange, Gesamtpreis | nur Cloud | K5, K14 | K5.2, K14.1 bis K14.5; "Add a folder" entfaellt |
| 10.21 | Referenzfotos (bis fuenf) unter dem Quellbild | nur Cloud | K1 | K1.19 |
| 10.22 | Charakter aus Videobildern speichern und wiederverwenden | nur Cloud | K8, K5 | K8.6, K5.5 |
| 10.23 | "Improve my prompt" (das Chatmodell schreibt den Prompt um) | nur Cloud | K4 | K4.5 |
| 10.24 | Prompt-Verlauf mit Einzel- und Gesamtloeschen | nur Cloud | K4 | K4.7 |
| 10.25 | Grundregler (Negativprompt, Quality, Aspect, Size, Length) | nur Cloud | K4 | K4.1, K4.2, K4.4, K4.6 |
| 10.26 | Ergebnisaktionen: mit Maske bearbeiten, animieren, Charakter speichern, Vollbild, loeschen | nur Cloud | K1, K8, K7 | K1.15 bis K1.17, K8.1 bis K8.8 |
| 10.27 | Galerie mit erneutem Signieren abgelaufener Adressen | nur Cloud | K6 | K6.1 bis K6.4, Zustand "Refreshing" |
| 10.28 | Ergebnis herunterladen | nur Cloud | K1, K7 | K1.13, K7.3 |
| 10.29 | Galeriebild als Quelle verwenden | nur Cloud | K8, K5 | K8.7, K5.4 |
| 10.30 | Laufenden Auftrag abbrechen, mit Erstattung | nur Cloud | K1 | K1.20 |
| 10.31 | Wartebild mit Phase und gemessener Dauer je Modell | nur Cloud | K1 | Zustand Laeuft |
| 10.32 | Prompt-Sperre gegen Darstellungen Minderjaehriger vor dem Absenden | nur Cloud | K1 | Zustand Prompt gesperrt bei K1.10 |
| 10.33 | Hinweis, wie lange Cloud-Ergebnisse abrufbar bleiben | nur Cloud | K1 | K1.21 |
| 11.1 | Model Manager mit "Get new" und "Installed" | uebernehmen | M1 | M1.2 |
| 11.2 | Katalog der Chatmodelle (Mainstream und Unfiltered) | uebernehmen | M1 | M1.4, eigene Auswahl kleiner Modelle |
| 11.3 | Suche nach GGUF-Modellen auf Hugging Face | uebernehmen | M1 | M1.3 |
| 11.4 | Groessenfilter und Passt-Anzeige fuer Chatmodelle | uebernehmen | M1, M2, A2 | Passt-Anzeige, Chip "Fits this phone" |
| 11.5 | Warnung "Below 7B" und Ausschluss kleiner Modelle aus der Empfehlung | uebernehmen | M1 | Als ein Satz ueber der Liste neu geschrieben, siehe offene Punkte |
| 11.6 | Modell herunterladen mit Fortschritt, Pause, Fortsetzen, Abbruch, Wiederholen und Pruefsumme | uebernehmen | M1, M2, M3 | M1.6 bis M1.8, M3.1 bis M3.4 |
| 11.7 | Pruefung auf freien Speicher vor dem Download | uebernehmen | G9 | vor M1.6, M2.2, A2.4 |
| 11.8 | Verwaiste Teil-Downloads finden und loeschen | uebernehmen | M1, E14 | M1.11, E14.3 |
| 11.9 | Geschwindigkeitsgrenze fuer Downloads | uebernehmen | E14 | E14.4 |
| 11.10 | Vision-Zusatzdatei (mmproj) wird mitgeladen | uebernehmen | M2 | Detailzeile Vision, wird mitgeladen |
| 11.11 | Installiertes Modell benutzen, Details ansehen, loeschen | uebernehmen | M1, M2 | M1.9, M2.3, M2.4 |
| 11.12 | Hugging-Face-Token fuer gesperrte Repos | uebernehmen | E14, M2 | E14.6 |
| 11.13 | Benchmark: Tempo und Trefferquote je Modell, Rangliste | uebernehmen | M4 | ueber M1.10, M2.5 |
| 11.14 | Expertenwerte der LU Engine (Kontext, Flash Attention, Cache-Typen, Threads, GPU-Schichten, mlock, mmap) | uebernehmen | E13 | E13.3 bis E13.8 |
| 11.15 | Diagnose, wenn die Engine nicht startet (Grund, Umschalten auf CPU) | uebernehmen | G10, E13, E19 | Kasten in E13, Pruefzeile in E19 |
| 12.1 | Cloud-Schalter (ganze App lokal oder in der Cloud) mit eigener Modellwahl je Modus | uebernehmen | C1, K1, C3, G11 | C1.1, C3.1 |
| 12.2 | Tor vor der Cloud: Verkaufsblatt, Anmelden, drei Tarife, offene Rechnung | uebernehmen | E3 | E3.1 bis E3.5 |
| 12.3 | Schaufenster fuer Cloud-Werkzeuge im lokalen Modus | uebernehmen | K1, K13 | Zustand lokaler Modus, K13 |
| 12.4 | Schalter "Cloud-Funktionen im lokalen Modus zeigen" mit Hinweis beim Ausschalten | uebernehmen | E4 | E4.3 |
| 12.5 | Konto mit Tarif und Guthabenbalken fuer die Abrechnungsperiode | uebernehmen | E2, E1 | Karte in E2, E1.1 |
| 12.6 | "Manage subscription" und "View plans" im Browser | uebernehmen | E2 | E2.9 |
| 12.7 | Gescheiterte Zahlung wird als solche gezeigt, mit "Pay open invoice" | uebernehmen | E2, E3, K1 | E2.10, E3.4 |
| 12.8 | Dialog "Guthaben leer" mit naechstem Schritt | uebernehmen | G5 | siehe 5.6 |
| 12.9 | Inhaltsrichtlinie des Kontos (Strict, Standard, Off) | uebernehmen | E18 | E18.1 |
| 12.10 | Hinweis auf Cloud-API-Schluessel mit Link zum Konto | uebernehmen | E2 | E2.13 |
| 12.11 | Katalog der Cloud-Modelle und Preise laden und zwischenspeichern | uebernehmen | C3, K3 | Ladezustaende der Kataloge, ohne eigenes Bedienelement |
| 12.12 | Anonymer Zaehler fuer Druecke auf den Cloud-Schalter | uebernehmen | E17 | wirkt an C1.1, abschaltbar in E17.1 |
| 13.1 | Anmelden mit E-Mail und Passwort | uebernehmen | E2 | E2.2 bis E2.4 |
| 13.2 | Konto anlegen | uebernehmen | E2 | E2.1, E2.4 |
| 13.3 | Anmelden mit Google oder GitHub ueber den Systembrowser | uebernehmen | E2, G14 | E2.5, E2.6 |
| 13.4 | Sitzung im Schluesselbund des Systems | uebernehmen | E2 | ohne Bedienelement; sichtbar daran, dass die Anmeldung einen Neustart ueberlebt |
| 13.5 | API-Schluessel fremder Anbieter im Schluesselbund | uebernehmen | E12, E9, E14 | Schluesselfelder E12.3, E9.2, E9.3, E14.6 |
| 13.6 | Abmelden, mit Rueckfrage bei nicht abgeglichenen Erinnerungen | uebernehmen | E2 | E2.14 |
| 13.7 | Abgelaufene Sitzung: Token wird je Aufruf erneuert, sonst klare Meldung | uebernehmen | G6 | siehe 5.7 |
| 14.1 | Begruessung | uebernehmen | A1 | A1.1 |
| 14.4 | Schritt "Model": empfohlenes Modell nach Hardware, Download, auch Modelle ohne Ablehnungen | uebernehmen | A2 | A2.2 bis A2.9 |
| 14.5 | Schritt "Documents": Embedding-Modell | uebernehmen | A3 | A3.2, A3.3 |
| 14.6 | Abschluss und Fortschrittsanzeige | uebernehmen | A4, A2 | A4.1, Fortschrittsstriche |
| 14.9 | Onboarding erneut starten | uebernehmen | E19 | E19.4 |
| 14.10 | Einfuehrung des Agent Mode zuruecksetzen | uebernehmen | E8 | E8.4 |
| 15.1 | Einstellungsseite mit vier Reitern und Sprungleiste | uebernehmen | E1 | Liste mit Unterseiten statt Reitern |
| 15.2 | Hell und Dunkel | uebernehmen | E4 | E4.1, zusaetzlich System |
| 15.3 | Eigenes Profilbild | uebernehmen | E4 | E4.2 |
| 15.4 | Vorgaben fuer Temperatur, Top P, Top K, Max Tokens | uebernehmen | E5 | E5.1 bis E5.4 |
| 15.5 | Schwelle fuer das automatische Verdichten | uebernehmen | E5 | E5.5 |
| 15.8 | Anbieterliste (ein und aus, Adresse, Schluessel, Verbindung pruefen) | uebernehmen | E12 | E12.1 bis E12.6 |
| 15.9 | Datenschutztext | uebernehmen | E17 | neu geschrieben |
| 15.10 | Zuruecksetzen je Reiter mit Rueckfrage | uebernehmen | E5, E8, E13, E19 | je Seite ein Zuruecksetzen: E5.7, E8.5, E13.9, E19.5 |
| 15.11 | Fehlersuche: Probe aller Backends auf einen Blick | uebernehmen | E19 | drei Pruefzeilen, E19.1 |
| 15.12 | Logdatei: Ordner oeffnen, Pfad kopieren | uebernehmen | E19 | E19.2 "Share log", E19.3 |
| 16.1 | Vom Handy aus ein Desktop-LU bedienen (Gegenseite von Remote Access: QR oder Adresse, Passcode, Chat, Agent) | uebernehmen | R1, R2, R3, R4 | ganzer Abschnitt 4.3 |
| 16.7 | Erklaertext "How it works" | uebernehmen | R5 | ueber R1.3, E15.2 |
| 17.1 | Agent-Workflows: Liste mit drei eingebauten (Research Topic, Summarize URL, Code Review) und eigenen | uebernehmen | E10, C5 | E10.1, C5.11; Code Review wird nicht gezeigt |
| 17.2 | Workflow-Baukasten mit sechs Schrittarten | uebernehmen | E10 | E10.4 bis E10.10 |
| 17.3 | Workflow aus dem Chat starten, Fortschritt Schritt fuer Schritt, Freigaben wie im Agent Mode | uebernehmen | C5, C2, C12 | C5.11, Schritte als Band C2.21, Freigabe C12 |
| 18.1 | Einen Chat exportieren (Markdown, JSON) | uebernehmen | C7 | C7.2 |
| 18.2 | Alle Chats sichern und wieder einlesen | uebernehmen | E16 | E16.1, E16.2 |
| 18.3 | Exporte aus ChatGPT, Claude und Gemini einlesen (JSON oder ZIP) und im Chat befragbar machen | uebernehmen | E16, C8 | E16.3, C8.7 |
| 18.4 | Erinnerungen exportieren (Markdown, JSON) und importieren | uebernehmen | E7 | E7.12, E7.13 |
| 18.5 | Automatische Sicherung aller Speicher in eine Datei und Wiederherstellung nach Speicherverlust des WebView | uebernehmen | E16, A1, G4 | E16.4, Wiederherstellung beim Start |
| 19.3 | Anzeige der eigenen Version | uebernehmen | E20 | Versionszeile, E20.4 |
| 19.4 | "What is new" einmal je Version, erneut oeffnen aus den Einstellungen | uebernehmen | E21 | E21.1, E20.1 |
| 20.1 | Rahmen der App mit Hauptnavigation (Chat, Create, Compare, Benchmark, Models, Settings) | uebernehmen | G1 | ganze Shell, Abschnitt 2 |
| 20.6 | Rechtsklick-Menue | uebernehmen | C6, C7, K8 | Blatt nach langem Druecken, immer auch ueber einen sichtbaren Knopf "More" |
| 20.8 | Fehlerschirm, der die App bedienbar haelt | uebernehmen | G4 | G4.1 bis G4.4 |
| 20.9 | Hinweis, wenn der Speicher des WebView voll ist | uebernehmen | G12 | Toast mit "Manage storage" |
| 20.10 | Stilles Herunterfahren der Engine bei Leerlauf mit sichtbarer Zeile | uebernehmen | G10, E13 | "The model was unloaded to free memory.", E13.7 |
| 20.11 | Dauerhafte Ablage: IndexedDB fuer Chats und Erinnerungen, Anhaenge als Dateien, "geschrieben heisst gelandet" | uebernehmen | C1, C2 | ohne Bedienelement; sichtbar in den Zustaenden nach Neustart, siehe 5.5 |
| 20.12 | Datenumzug zwischen Versionen | uebernehmen | G4 | ohne Bedienelement; bei gescheitertem Umzug G4 mit "Restore from backup" |
| 20.13 | Logbuch in Datei und Absturzbericht | uebernehmen | E19, G4 | E19.2, G4.3 |

### 6.1 Zeilen, die nur mit Abweichung untergebracht sind

Keine Zeile blieb ohne Screen. Diese Zeilen weichen vom Desktop ab und brauchen ein Auge bei der Abnahme:

| Nr. | Abweichung |
|---|---|
| 1.29 | Es gibt kein eigenes Startbild mit letzten Chats. Die Chat-Liste C1 ist die Startseite und erfuellt denselben Zweck. |
| 5.8, 5.9 | Dateiwerkzeuge arbeiten nur im festen Ordner des Chats im App-Speicher. Sichtbar ist er als "Files in this chat" (C7.6), nicht als Pfad. |
| 5.19, 5.20, 1.20 | Die drei verbleibenden Schraegstrich-Befehle haben zusaetzlich sichtbare Zeilen in C5, damit niemand einen Befehl kennen muss. |
| 8.5 | Die Systemstimme ist nur da, wenn der WebView sie anbietet. Fehlt sie, wird E11.5 nicht gezeigt und Vorlesen ist reine Cloud-Funktion. |
| 10.20 | "Add a folder" entfaellt, Mehrfachauswahl in der Fotoauswahl ersetzt es. |
| 11.5 | Der Text "Below 7B" wird nicht uebernommen, sondern als ein Satz ueber der Modellliste neu geschrieben. Entscheidung fuer David, siehe offene Punkte. |
| 11.9 | Die Geschwindigkeitsgrenze steht in E14.4. Wenn der Systemdienst fuer Downloads sie nicht steuern laesst, wird die Zeile nicht gezeigt. |
| 12.12 | Der anonyme Zaehler bekommt einen sichtbaren Schalter in E17.1, den es am Desktop nicht gibt. |
| 15.10 | "Zuruecksetzen je Reiter" wird zu einem Zuruecksetzen je Unterseite plus "Reset all settings" in E19. |
| 17.1 | Der eingebaute Workflow Code Review wird nicht gezeigt, weil er einen Projektordner voraussetzt. |
| 20.6 | Das Rechtsklick-Menue wird zum Blatt nach langem Druecken und ist immer auch ueber einen sichtbaren Knopf "More" erreichbar. |

## 7. Design-Tokens

Datei spaeter: `src/mobile/styles/tokens.css`. Alle Namen tragen das Praefix `--m-`. Die Werte sind aus `src/index.css` abgeleitet (Leiter `--color-lu-*`, Akzent `#a094f8`, Cloud `#7c3aed`, Bewegung `--motion-*`). Der Desktop-Zoom `--ui-scale: 1.15` gilt auf dem Handy nicht.

### 7.1 Farben

| Token | Dunkel | Hell | Rolle | Herkunft am Desktop |
|---|---|---|---|---|
| `--m-canvas` | `#141414` | `#f3f4f6` | Leinwand der App | `--color-lu-canvas`, hell `bg-gray-100` |
| `--m-surface` | `#1e1e1e` | `#ffffff` | Karten, Listen, Eingabefeld, Reiterleiste | Pane und Sidebar `#1e1e1e` |
| `--m-sheet` | `#202020` | `#ffffff` | Blatt und Dialog | `--color-lu-base` |
| `--m-overlay` | `#363636` | `#ffffff` | Toast, gewaehltes Segment | `--color-lu-overlay`, `.lu-elevated` |
| `--m-fill` | `rgba(255,255,255,.06)` | `rgba(0,0,0,.05)` | Felder, Nutzerblase, Gruppen im Blatt | `bg-white/[0.06]` |
| `--m-fill-2` | `rgba(255,255,255,.10)` | `rgba(0,0,0,.08)` | gedrueckt, Balkenbahn, Marken | `bg-white/10` |
| `--m-hair` | `rgba(255,255,255,.08)` | `rgba(0,0,0,.10)` | Haarlinien | `border-white/[0.08]` |
| `--m-edge` | `rgba(255,255,255,.14)` | `rgba(0,0,0,.16)` | Rand von Knoepfen | `.lu-control` aktiv |
| `--m-t1` | `#f3f4f6` | `#111827` | Haupttext | `--pk-t1` |
| `--m-t2` | `#d1d5db` | `#374151` | Fliesstext zweiter Ordnung | `--pk-t2` |
| `--m-t3` | `#9ca3af` | `#4b5563` | Zusatztext, Symbole | `--pk-t3`, hell eine Stufe dunkler fuer Kontrast auf der Leinwand |
| `--m-accent` | `#a094f8` | `#a094f8` | Hauptknopf, Schalter an, Fortschritt, Fokus | `--color-lu-accent` |
| `--m-accent-press` | `#b1a6ff` | `#b1a6ff` | Hauptknopf gedrueckt | `--color-lu-accent-hover` |
| `--m-on-accent` | `#111827` | `#111827` | Text auf Akzent | `--color-lu-on-accent` |
| `--m-accent-edge` | `#a094f8` | `#8b7cf0` | Rand des Hauptknopfs | `--color-lu-accent-edge` |
| `--m-accent-text` | `#b1a6ff` | `#6d28d9` | Akzent als Textfarbe | neu, fuer Kontrast |
| `--m-accent-soft` | `rgba(160,148,248,.14)` | `rgba(124,58,237,.10)` | gewaehlte Kachel | `--color-lu-accent-soft` |
| `--m-cloud` | `#a78bfa` | `#6d28d9` | Cloud als Text und Punkt | `--color-lu-cloud-lift`, hell abgedunkelt |
| `--m-cloud-edge` | `#7c3aed` | `#7c3aed` | Cloud-Knopf, Cloud-Schalter an, Cloud-Balken | `--color-lu-cloud` |
| `--m-cloud-soft` | `rgba(124,58,237,.18)` | `rgba(124,58,237,.10)` | Flaeche des Cloud-Chips | `bg-lu-cloud/10` |
| `--m-ok` | `#34d399` | `#047857` | passt, lokal, Erfolg, Agent | `--pk-ok` |
| `--m-tight` | `#38bdf8` | `#0369a1` | knapp | `bg-sky-500` der Passt-Anzeige |
| `--m-warn` | `#9ca3af` | `#4b5563` | Hinweis, angehalten. Ein ruhiges Grau, mit Absicht kein Gelb (Regel des Repos "kein Gelb", gilt auch mobil). Die Bedeutung traegt das Symbol und der Text. | neu |
| `--m-warn-soft` | `rgba(255,255,255,.06)` | `rgba(0,0,0,.05)` | Flaeche des Hinweiskastens | neu |
| `--m-err` | `#f87171` | `#b91c1c` | Fehler, zerstoerend, zu gross | `--pk-err` |
| `--m-scrim` | `rgba(0,0,0,.55)` | `rgba(17,24,39,.35)` | Schleier hinter Blatt und Dialog | neu |

Regeln: Violett `--m-accent` ist die Farbe fuer "das ist der naechste Schritt". Das dunklere `--m-cloud-edge` heisst immer "Cloud, kostet Guthaben". Gruen heisst lokal oder gelungen. Farbe traegt nie allein eine Aussage, daneben steht immer ein Wort oder Symbol. Kontrast: Text mindestens 4,5 zu 1, Symbole und Raender von Bedienelementen mindestens 3 zu 1, in beiden Themen. Keine Tailwind-Utilities fuer `filter`, `backdrop-filter` und `ring` (alte WebViews), keine Transparenzeffekte hinter Text.

### 7.2 Schrift

Familien wie am Desktop: Inter fuer alles, Space Grotesk fuer `display`, `ui-monospace, 'JetBrains Mono'` fuer Zahlen und Code. Die Dateien liegen schon unter `public/fonts/`.

| Token | Wert | Bei 100 Prozent | Gewicht | Zeilenhoehe | Einsatz |
|---|---|---|---|---|---|
| `--m-text-display` | `1.5rem` | 24 px | 500 | 1.2 | Titel der Wurzeln, leere Zustaende |
| `--m-text-title` | `1.0625rem` | 17 px | 600 | 1.3 | Seitentitel, Kartentitel, Blatttitel |
| `--m-text-body` | `1rem` | 16 px | 400 | 1.45 | Nachrichten, Listenzeilen, Felder |
| `--m-text-control` | `0.9375rem` | 15 px | 500 | 1.2 | Knoepfe, Segmente, Chips |
| `--m-text-caption` | `0.8125rem` | 13 px | 400 | 1.4 | Zusaetze, Hinweise |
| `--m-text-label` | `0.75rem` | 12 px | 600 | 1 | Gruppentitel, Versalien mit 0.08em |
| `--m-text-mono` | `0.8125rem` | 13 px | 400 | 1.3 | Zahlen, Groessen, Zeiten |
| `--m-text-tab` | `min(0.6875rem, 15px)` | 11 px | 500 | 1 | Reiterleiste, Aktionsreihen |

Kleinste Schrift ist 11 px und nur in der Reiterleiste und in Aktionsreihen unter Symbolen. Eingabefelder haben mindestens 16 px, sonst zoomt iOS beim Fokus.
Systemschrift: `html` bekommt auf iOS `font: -apple-system-body` und damit die Dynamic-Type-Groesse, auf Android setzt die native Schicht den WebView-Textzoom auf 100 und reicht `fontScale` durch, die Shell setzt daraus `html { font-size: calc(16px * var(--m-font-scale)) }`. Obergrenze 200 Prozent. Geprueft bei 100, 150 und 200 Prozent (`mock/shots/320x568-light-200--*.png`).

### 7.3 Abstaende, Groessen, Radien

Abstaende und Mindestgroessen stehen in px und wachsen nicht mit der Schrift.

| Token | Wert | Einsatz |
|---|---|---|
| `--m-s1` bis `--m-s8` | 4, 8, 12, 16, 20, 24, 32 px | Raster in 4 px |
| `--m-gutter` | 16 px | Seitenrand |
| `--m-touch` | 44 px | Mindesthoehe und Mindestbreite jedes Ziels |
| `--m-row` | 52 px | Mindesthoehe einer Listenzeile und eines Reiters |
| `--m-icon` | `min(1.375rem, 28px)` | Symbole (22 px), klein `min(1.125rem, 24px)` |
| `--m-measure` | 42rem | groesste Inhaltsbreite im Querformat |
| `--m-r-sm` | 6 px | Marken, Codestuecke |
| `--m-r-md` | 10 px | Symbolknoepfe, Kacheln der Galerie |
| `--m-r-lg` | 14 px | Knoepfe, Felder, Karten, Gruppen |
| `--m-r-xl` | 20 px | Eingabefeld, Blatt (oben), Dialog, Buehne |
| `--m-r-pill` | 999 px | Chips, Schalter, Senden |
| `--m-safe-top/right/bottom/left` | `env(safe-area-inset-*)` | Safe Areas |
| `--m-kb` | Hoehe der Tastatur aus `visualViewport` | Abstand unter Eingabefeld und Blatt |

Die Radien sind groesser als am Desktop (8 und 12 px), weil die Flaechen groesser sind. Die Leiter bleibt bei fuenf Stufen.
Schatten: nur an Blatt, Dialog und Toast. Karten haben im Dunkeln keinen Rand und keinen Schatten, im Hellen eine Haarlinie.

## 8. Komponenten

Alle unter `src/mobile/ui/`. Jede Komponente bringt Rolle, Namen und Fokusverhalten selbst mit; ein Screen kann kein namenloses Ziel bauen, weil `label` Pflichtparameter ist.

| Komponente | Verhalten |
|---|---|
| `Page` | Seite mit Kopfzeile (Zurueck, Titel, bis zwei Aktionen), rollbarem Inhalt, optionaler Fusszeile. Setzt Safe Areas, meldet den Titel an Screenreader, legt beim Oeffnen den Fokus auf den Titel. Der Inhalt behaelt seine Rollposition, wenn man von einer Unterseite zurueckkommt. |
| `RootPage` | Wurzel mit grossem Titel und Aktionen rechts, die bei Enge unter den Titel umbrechen. |
| `TabBar` | Vier Reiter, Rolle `tablist`. Wird im Querformat zur Schiene. Traegt Punkte fuer laufende Vorgaenge. |
| `Sheet` | Bottom Sheet mit Griff, Titel und sichtbarem Schliessen-Knopf. Hoehe folgt dem Inhalt bis 88 Prozent, darueber rollt der Inhalt. Schliessen ueber Knopf, Schleier, Herunterziehen am Griff und Zurueck. Haelt einen Stapel-Eintrag, faengt den Fokus, gibt ihn beim Schliessen an den Ausloeser zurueck. Schiebt sich ueber die Tastatur. Unterseiten (`Sheet.Page`) mit Zurueck-Pfeil im Blattkopf. Im Querformat hoechstens 480 px breit und mittig. Variante `locked` (C12) ohne Wegwischen. |
| `Dialog` | Mittig, hoechstens 340 px breit, Rolle `alertdialog`. Nur fuer Rueckfragen und Fehler mit Entscheidung. Knoepfe untereinander, volle Breite. Zurueck waehlt die sichere Antwort. |
| `Toast` | Ein Satz, Rolle `status` (Fehler `alert`), 3 s, eine optionale Aktion. Wartet, solange ein Systemblatt offen ist. Hoechstens einer zugleich. |
| `List`, `ListGroup` | Gruppe mit optionalem Gruppentitel in Versalien, Haarlinien zwischen den Zeilen. |
| `Row` | Zeile mit Symbol, Titel, Zusatz, rechts Wert, Pfeil, Schalter, Radio oder Knopf. Ganze Zeile ist das Ziel. Mindesthoehe 52 px, Text bricht um. Hat die Zeile zwei Ziele (C1.4 und C1.5), sind es zwei getrennte Knoepfe mit je 44 px. |
| `Switch` | 51 mal 31 px, Rolle `switch`, immer als Teil einer `Row` mit Text. Wirkt sofort, ohne Speichern-Knopf. |
| `Segmented` | Zwei bis vier Optionen, Rolle `radiogroup`. Bricht bei grosser Schrift in mehrere Zeilen um, statt Text zu kuerzen. |
| `Chip` | Filter (Rolle `button` mit `aria-pressed`) oder Auswahl (Radio). 44 px hoch. Status-Chips im Eingabefeld sind optisch 28 px, ihr Ziel 44 px. |
| `Button` | Varianten `primary` (Akzent, einer je Screen), `cloud` (Cloud-Violett), `default` (Rand), `quiet` (nur Text), `danger`. Mindesthoehe 44 px, Text bricht um. Zustand `busy` zeigt einen Fortschrittsring und sperrt doppeltes Tippen. |
| `IconButton` | 44 mal 44 px, `label` Pflicht, optional Zaehlerpunkt, dessen Zahl im Namen steht ("Downloads, 1 active"). |
| `Field`, `TextArea` | Feld mit sichtbarem Label oder `aria-label`, Fehlertext darunter, passende Tastatur (`inputmode`, `autocomplete`), "Paste" und "Clear" als Knoepfe bei Schluesselfeldern. |
| `Slider`, `NumberField` | Schieber mit sichtbarem Wert in Mono und Plus- und Minus-Knoepfen daneben, damit kein Feinmotorik-Ziehen noetig ist. |
| `Progress` | Balken (bestimmt, mit Prozent und Groessen in Mono) und Ring (unbestimmt). Rolle `progressbar` mit Werten. Zustand angehalten in Grau. |
| `Notice` | Kasten mit Symbol, Titel, einem bis zwei Saetzen und bis zu zwei Knoepfen. Varianten info, warn, error. warn ist das ruhige Grau mit Warnsymbol, kein Gelb (entschieden am 08.10.2026). Das Muster aller Fehlerfaelle in Abschnitt 5. |
| `Banner` | Schmale Zeile unter der Kopfzeile (G7, G10). |
| `EmptyState` | Symbol oder Monogramm, Titel, ein Satz, bis zu zwei Knoepfe. Jede Liste und jede Suche hat einen. |
| `Skeleton` | Platzhalterzeilen und Karten beim Laden, ohne Schimmer bei reduzierter Bewegung. |
| `FitBadge` | Punkt und Text der Passt-Anzeige, vier Stufen. |
| `ModelChip` | Modellwahl im Eingabefeld mit Punkt fuer lokal oder Cloud. |
| `Composer` | Eingabefeld mit Statuszeile, Textfeld, Bedienzeile und dem gemeinsamen Platz fuer Diktat, Senden und Stop. Unter 16rem Breite rutscht die Modellwahl in eine eigene Zeile. Bei offener Tastatur und weniger als 600 px Hoehe wird die Statuszeile ausgeblendet. Wird von C2, R4, C9 und K1 benutzt. |
| `MediaViewer` | Vollbild fuer Bild, Video, Ton mit Zoom, Wischen und Aktionen. |
| `ConfirmHold` | gibt es nicht. Zerstoerendes laeuft immer ueber `Dialog`, nie ueber "zweimal tippen". |

## 9. Bewegung

Sparsam. Bewegung zeigt nur, woher etwas kommt und wohin es geht.

| Vorgang | Bewegung | Dauer |
|---|---|---|
| Seite oeffnen und schliessen | schiebt von rechts ein, die untere Seite weicht um 25 Prozent nach links | 300 ms, `cubic-bezier(.2,0,0,1)` |
| Zurueck-Geste auf iOS | die Seite folgt dem Finger, ab 40 Prozent oder schnellem Wisch wird geschlossen | fingergefuehrt |
| Blatt | faehrt von unten ein, Schleier blendet | 300 ms |
| Dialog, Toast | blenden ein mit 24 px Versatz | 200 ms |
| Druck auf ein Ziel | Deckkraft 70 Prozent | 120 ms |
| Schalter, Segment | Knopf gleitet | 120 ms |
| Fortschritt | Breite waechst linear | 300 ms je Schritt |
| Schreibmarke im Stream | blinkt | 600 ms |
| Reiterwechsel | keine Bewegung, harter Wechsel | 0 |

Regeln: Keine Bewegung beim Laden einer Liste, kein Federn, keine Parallaxe, keine Partikel.

Ausnahme fuer genau eine Stelle (Entscheidung D5, 17.10.2026): der Schaukasten der Seite E3 LU Cloud (`screens/settings/cloud/CloudShowcase.tsx`). Dort bewegen Keyframes nur `transform` und `opacity`, jede Animation endet von selbst, die Szenen wechseln zwei Runden lang alle 4,5 s und stehen dann; nichts bewegt sich im Hintergrund, ausserhalb des Bildes, nach einer Wahl am Segment oder bei "Bewegung reduzieren" (dann steht jede Szene fertig). Keine Verlaeufe, kein Weichzeichner. Der Waechter `cloud-schaukasten.test.ts` liest die CSS-Datei. Bei "Bewegung reduzieren" werden Schieben und Fahren zu einem Ueberblenden von 120 ms, die Schreibmarke steht. Haptik: ein leichter Impuls bei Senden, bei Stop, beim Umlegen eines Schalters und wenn ein Download fertig ist, sonst keine.

## 10. Barrierefreiheit

- **Namen.** Jedes Ziel hat einen zugaenglichen Namen in Worten. Ein Symbol, eine Zahl, eine Dateiendung oder eine Groesse ist kein Name. Zaehler stehen im Namen ("Downloads, 1 active"), nicht davor. Namen nennen das Ziel, wenn es mehrere gleiche Knoepfe gibt ("More for Trip plan for Lisbon").
- **Rollen.** `tablist` und `tab` fuer die Leiste, `switch` fuer Schalter, `radiogroup` und `radio` fuer Segmente und Auswahllisten, `dialog` mit `aria-modal` fuer Blaetter, `alertdialog` fuer Dialoge, `progressbar` mit Werten, `status` fuer Toast und Laufanzeige, `alert` fuer Fehlerkaesten, `log` mit `aria-live="polite"` fuer den Verlauf (die fertige Antwort wird einmal angesagt, nicht jedes Wort).
- **Zustand.** `aria-checked`, `aria-pressed`, `aria-expanded`, `aria-disabled` statt nur Farbe. Gesperrte Ziele nennen den Grund im Namen oder im Zusatz.
- **Fokus.** Sichtbarer Ring 2 px in `--m-accent` an allem, was Fokus haben kann (Tastatur am Tablet, Schaltersteuerung). Eine neue Seite setzt den Fokus auf ihren Titel, ein Blatt auf seinen Titel, ein Dialog auf die sichere Antwort. Beim Schliessen geht der Fokus zum Ausloeser zurueck. Blatt und Dialog fangen den Fokus, der Hintergrund ist `inert`.
- **Reihenfolge.** Die Lesereihenfolge folgt dem Aufbau von oben nach unten; die Reiterleiste kommt zuletzt.
- **Ziele.** Mindestens 44 mal 44 px, mindestens 8 px Abstand zwischen zwei Zielen oder eine gemeinsame Flaeche ohne Luecke.
- **Schrift.** Bis 200 Prozent ohne Verlust: Zeilen brechen um, Segmente stapeln sich, das Eingabefeld gibt der Modellwahl eine eigene Zeile, Dialoge und Blaetter rollen. Nichts ist auf eine feste Hoehe gesetzt, die Text abschneidet.
- **Gesten.** Jede Geste (Wischen fuer Zurueck, langes Druecken, Herunterziehen des Blatts, zwei Finger im Maskeneditor) hat einen Knopf als Ersatz. Ausnahme ist das Malen selbst.
- **Bewegung und Ton.** "Bewegung reduzieren" wird beachtet. Vorlesen startet nie ohne Zutun, ausser der Nutzer hat E11.4 eingeschaltet.
- **Sprache.** `lang="en"` am Dokument, Antworten des Modells bekommen kein eigenes `lang`.
- **Pruefung.** Namen und Rollen werden ueber den Accessibility-Baum gelesen (`Accessibility.getPartialAXTree` auf Android, Accessibility Inspector im Simulator), nicht ueber `title`.

## 11. Offene Punkte fuer David

1. **Text statt "Below 7B".** Vorschlag in M1: "Models that fit a phone are small. For long or tricky tasks LU Cloud is stronger." Der Satz wirbt zugleich fuer Cloud. Gewollt?
2. **Kauf im Browser.** E3, E2.9, G5.1 fuehren auf lu-labs.ai. Ob die Stores das fuer Guthaben zulassen, ist offen. Faellt die Antwort negativ aus, braucht E3 eine andere Fassung (iOS: nur Anmelden, kein Kauflink).
3. **"Unfiltered", "No refusals", Inhaltsrichtlinie Off.** Stehen im Entwurf wie am Desktop (A2, M1, C3, E18). Store-Frage.
4. **Passwort vergessen.** E2.7 ist neu und oeffnet die Webseite. Am Desktop gibt es den Weg nicht.
5. **Gemeinsamer Platz fuer Diktat und Senden.** Mit Text im Feld ist das Mikrofon weg. Wer nach dem Tippen diktieren will, muss das Feld leeren. Das spart auf 320 pt die Breite fuer den Modellnamen. Alternative waere eine zweite Zeile im Eingabefeld.
6. **Agent-Rechte.** Die Gruppen in E8 und C5.14 (Web, Files in chat, Memory, Workflows, Sub agents) sind aus dem Werkzeugkatalog abgeleitet, der fuer das Handy noch gekuerzt werden muss. Die endgueltige Liste haengt am Rust-Strang.
7. **Remote ueber das Internet.** Der Entwurf geht vom selben Netz aus (QR oder Adresse). Eine Tunnel-Adresse des Desktops funktioniert in R2 genauso, wird aber nicht beworben.
8. **Sprache als Sitzung (Astra).** Nicht entworfen, laut Entscheidung kein Astra. Diktat und Vorlesen sind Einzelaufrufe.
9. **Tablets.** Der Entwurf deckt 320 bis 440 pt Breite und das Querformat des Handys. Ein eigenes Zwei-Spalten-Layout fuer iPad und grosse Android-Tablets ist nicht entworfen; dort laeuft das Querformat-Layout mit begrenzter Inhaltsbreite.
10. **Schriften im Prototyp.** `mock/index.html` laedt keine Dateien nach und faellt deshalb auf die Systemschrift zurueck. In der App kommen Inter und Space Grotesk aus `public/fonts/`.
