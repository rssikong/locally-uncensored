# Google Play: Store-Eintrag

Stand 10.10.2026. Gilt fuer das Paket aus `scripts/mobile/release/android-play.sh` (Preset `play`). Was dieses Preset zeigt und was nicht, steht in `src/mobile/policy/storePolicy.ts`, die Texte hier sagen nichts, was der Play-Bau nicht hat.

Die Bloecke mit der Kennung `store` sind die Texte fuer die Konsole, woertlich zum Kopieren. Der Waechter `src/mobile/__tests__/store-unterlagen.test.ts` prueft sie mit denselben Wortregeln wie die App (`e2e/mobile/store-rules.ts`, Preset `play`) und zaehlt die Zeichen. Kennungen in doppelten geschweiften Klammern stehen in `PLATZHALTER.md`.

Keine Preisaussage: Kein Text sagt, was die App oder LU Cloud kostet oder dass etwas nichts kostet.

Entschieden am 10.10.2026 (`FUER-DAVID.md`, "Entschieden"): Die App heisst bei Google Play nur `LU`. Kein Text nennt den langen Namen des Desktop-Produkts, in keiner Schreibweise, und keiner nennt ein Wort ueber Antworten ohne Ablehnungen. Der Waechter haelt beides.

Adressen fuer die Play Console (Werte in `PLATZHALTER.md`, seit 14.10.2026 alle live):

| Feld | Kennung |
|---|---|
| Store-Eintrag, Kontakt: E-Mail | `{{SUPPORT_EMAIL}}` |
| Store-Eintrag, Kontakt: Website (freiwillig) | `{{MARKETING_URL}}` |
| App-Inhalte, Datenschutzerklaerung | `{{PRIVACY_URL}}` |
| Datensicherheit, Kontoloeschung im Web | `{{ACCOUNT_DELETE_URL}}` |

## 1. Titel (hoechstens 30 Zeichen)

```store play.title max=30
LU
```

Der Name ist entschieden (`{{APP_NAME_PLAY}}`: `LU`, 10.10.2026). Die App nennt sich im Play-Bau ueberall `LU`. Nicht entschieden und nicht Teil des Namens: die Kennung des Pakets (`applicationId`), die in der Adresse des Store-Eintrags steht (`FUER-DAVID.md`, "Offen").

## 2. Kurzbeschreibung (hoechstens 80 Zeichen)

```store play.short max=80
AI chat that runs on your phone. Optional cloud models for images and voice.
```

## 3. Langbeschreibung (hoechstens 4000 Zeichen)

```store play.full max=4000
LU is an AI assistant that can run on your phone. Download a model once, then chat without a connection and without an account. What you write to an on device model stays on this phone.

ON YOUR PHONE
• Chat with language models that run on the phone itself
• A catalogue of models, each marked with how well it fits the memory of your phone
• Ask questions about your own documents
• An agent that uses tools such as web search, with a permission for every kind of action
• Memory, personas, workflows and a side by side comparison of two models
• Answers read aloud with the voice of your phone

WITH LU CLOUD (OPTIONAL, NEEDS SIGNING IN)
• Larger hosted models for chat
• Create: images and video from a prompt, and your own characters
• Dictation and Cloud voices
LU asks before it sends anything to LU Cloud for the first time. You can take that consent back in the settings.

WITH LU ON YOUR COMPUTER
• Pair the phone with LU on your own computer and use the models there from the phone

YOUR DATA
• Chats with on device models stay on the phone
• No ads and no tracking across apps
• LU counts one thing: taps on the Cloud switch, with the direction, the platform and the app version. No account, no content, no device ID. You can turn it off under Privacy
• You can delete your account inside the app
• One file backs up all your chats, to keep or to move

SAFETY
• LU is made for adults and asks you to confirm that you are 18 or older
• Every AI answer and every generated image or video has a Report button
• AI models make mistakes. Check what matters before you rely on it

WHAT YOU NEED
• Android 7.0 or later on a 64 bit ARM phone
• On device models need memory. Before a download LU tells you whether a model fits your phone
• A connection once to download a model, and whenever you use LU Cloud

LU is open source under the AGPL-3.0 license.
```

Belege je Aussage: Modelle auf dem Geraet und Katalog mit Passung (`screens/models`; seit dem 18.10.2026 nur die Dateien, die der Katalog nennt, `customModelUrl: false`: kein "Import a model file", keine anderen Packungen, keine Suche am Hub, darum steht die fruehere Zeile "Bring your own model file in the GGUF format" nicht mehr im Text), Dokumente, Agent, Websuche, Erinnerungen, Personas, Workflows, Vergleich (`screens/agent`), Vorlesen mit der Stimme des Handys und Diktat ueber LU Cloud (`strings/settings.ts`), Create mit Bild, Video und Charakteren (`screens/create`), Einwilligung (`policy/consent.ts`), Fernzugriff (`remoteDesktop` an im Preset `play`), Zaehler (`strings/settings.ts`, Seite Privacy), Konto loeschen (`accountDeletion`), Sicherung (`Backup and import`), Altersfrage (`ageGate: declare-18`), Meldeknopf (`reportContent`), Android 7.0 und arm64 (`minSdkVersion 24`, nur `arm64-v8a`).

## 4. Schlagwoerter

Google Play hat kein freies Feld fuer Schlagwoerter. In der Konsole waehlt man bis zu fuenf Tags aus einer festen Liste (Store-Eintrag, Tags). Vorschlag, in der Liste nach dem naechstliegenden Eintrag suchen: Productivity, Artificial intelligence, Chat, Tools, Notes.

Suchbegriffe, die der Text oben schon traegt, alle neutral: AI chat, on device, offline, assistant, documents, images, voice. "GGUF" ist seit dem 18.10.2026 keiner mehr, das Paket bringt keine eigene Datei ein. Kein Wort ueber Antworten ohne Ablehnungen.

## 5. Kategorie

- App-Typ: App.
- Kategorie: Productivity. Zweite Wahl: Tools.

## 6. Altersfreigabe (Fragebogen der IARC in der Konsole)

Ehrlich nach dem, was das Preset `play` wirklich zeigt. Neu bewertet am 18.10.2026 nach der Entscheidung zum Zuschnitt (`FUER-DAVID.md` Nr. 30, Option c, Runde 56). Vorher am 10.10.2026 nach dem Abschalten der offenen Suche am Modell-Hub (`hubSearch: false`).

Was mit Option (c) wegfaellt, je eine Zeile im Preset `play` (`src/mobile/policy/storePolicy.ts`):

- **Keine Cloud-Modelle mit der Marke "Direct"** und kein Modell, das der Server als "ohne Ablehnungen" kennzeichnet (`unfilteredCatalog: false`, `directBadge: false`). Die Auswahl und Create listen dieselben Modelle wie das App-Store-Paket.
- **Kein Katalogmodell ohne Ablehnungen** auf dem Handy (`unfilteredCatalog: false`).
- **Keine eigene Modelldatei**: kein "Import a model file", keine anderen Packungen eines Repositorys, nur die Dateien, die der Katalog nennt (`customModelUrl: false`). Die offene Suche am Hub war schon seit dem 10.10.2026 aus. Mit ihr faellt das Feld fuer einen Hugging-Face-Token weg (`gatedModelToken: false`).

Beim Modellangebot ist das Play-Paket damit so eng wie das App-Store-Paket (`APPSTORE-EINTRAG.md` 7). Grund der Entscheidung: Googles Richtlinie untersagt Apps, die sexuelle Inhalte erzeugen, und das Risiko trifft das ganze Entwicklerkonto. Das offene APK von der Webseite behaelt alles.

Was weiter fuer "Ja" bei Sexualitaet, Gewalt und derber Sprache als Text spricht, jeder Punkt fuer sich allein:

1. **Der Cloud-Chat** wird nicht nach einer Stufe gefiltert. Es fehlen nur die Modelle, die der Server als "ohne Ablehnungen" kennzeichnet; was ein verbleibendes Cloud-Modell schreibt, haengt an diesem Modell. Filtern koennte nur der Server (`geruest-wuensche/server.md`).
2. **Kein Wortfilter auf dem Geraet.** Die App legt keinen Filter ueber die Antworten eines Modells, das auf dem Handy laeuft. Auch ein gewoehnliches Katalogmodell schreibt auf Wunsch Text zu Themen fuer Erwachsene, soweit es selbst nicht ablehnt.

Gefiltert sind die Cloud-Medien in Create (hoechstens Stufe Standard, `contentLevels: no-off`), und Create listet kein Modell, das als fuer Erwachsene gekennzeichnet ist.

Ergebnis: Die Antworten in der Tabelle bleiben "Ja", weil Text dieser Art auf Wunsch des Nutzers weiter entstehen kann; er entsteht seltener, und kein Angebot des Pakets ist dafuer gemacht. Eine mildere Antwort waere nicht ehrlich. Was die Entscheidung aendert, ist die Lage gegenueber Googles Richtlinie zu KI- und sexuellen Inhalten: das Paket bietet nichts mehr an, das fuer solche Inhalte gemacht ist oder dafuer wirbt.

| Frage | Antwort | Warum |
|---|---|---|
| Kategorie der App im Fragebogen | Alle anderen App-Typen (kein Spiel, kein soziales Netzwerk) | Assistent ohne Austausch zwischen Nutzern |
| Gewalt | Ja, als Text, vom Nutzer veranlasst, nicht bildlich im Mittelpunkt | ein Sprachmodell beschreibt Gewalt, wenn man es darum bittet |
| Sexualitaet oder Nacktheit | Ja, als Text, vom Nutzer veranlasst, seltener seit Option (c) | ungefilterter Cloud-Chat und kein Wortfilter auf dem Geraet. Direct-Modelle, Katalogmodelle ohne Ablehnungen, Import und die offene Suche gibt es im Paket nicht mehr. Bilder in Create sind gefiltert (Standard), die Pruefung laeuft in der App, der Server liest die Obergrenze noch nicht (`STORE-BAUSTEINE.md` 2.1) |
| Derbe Sprache | Ja | wie oben |
| Drogen, Alkohol, Tabak | Ja, als Erwaehnung in Text, vom Nutzer veranlasst | wie oben |
| Gluecksspiel, simuliert oder echt | Nein | gibt es nicht |
| Furcht oder Horror | Nein als Inhalt der App, als Text auf Wunsch moeglich | wie oben, falls die Frage gestellt wird: Ja |
| Nutzer tauschen Inhalte untereinander aus | Nein | kein Profil, kein Feed, kein Chat zwischen Menschen |
| Die App gibt den Standort an andere weiter | Nein | kein Standortrecht |
| Digitale Kaeufe in der App | Nein | Preset `play`: kein Kauf, kein Link, nur ein Hinweissatz ohne Link |
| Die App ist ein Browser oder eine Suchmaschine | Nein | die Websuche ist ein Werkzeug des Agenten, Links oeffnet der Browser des Systems |
| Inhalte, die von KI erzeugt werden | Ja | Formular "KI-generierte Inhalte" unter App-Inhalte: Meldeknopf in der App vorhanden |

Dazu unter App-Inhalte:

- Zielgruppe: nur 18 und aelter. Die App fragt beim ersten Start "Are you 18 or older?" (eine Erklaerung auf dem Geraet, kein Nachweis).
- Anzeigen: Nein.
- Nachrichten-App, Gesundheits-App, Finanz-App, Behoerden-App: jeweils Nein.

**Entschieden am 18.10.2026 (Option c, `FUER-DAVID.md` Nr. 30):** Das Paket ist beim Modellangebot so eng geschnitten wie das App-Store-Paket. Die Einstufung faellt trotzdem hoch aus, weil der Cloud-Chat ungefiltert bleibt und die App keinen Wortfilter hat. Eintragen in der Konsole bleibt Davids Schritt (Nr. 4). Zurueck zu (a): `unfilteredCatalog`, `customModelUrl`, `directBadge` und `gatedModelToken` im Preset `play` auf `true`, dann gelten wieder die Begruendungen von vor dem 18.10. (Direct-Modelle, Import) und die Zeile GGUF in der Langbeschreibung.

## 7. Datensicherheit (Formular der Konsole)

Aus `STORE-BAUSTEINE.md` Abschnitt 9, dort steht je Zeile der Beleg im Code.

Grundfragen:

| Frage | Antwort |
|---|---|
| Erhebt oder teilt die App Nutzerdaten | Ja |
| Werden alle Daten bei der Uebertragung verschluesselt | Ja. Was die App an LU Cloud und andere Dienste sendet, geht ueber https. Die Frage meint Daten, die vom Geraet an den Entwickler oder an Dritte gehen. Nicht darunter fallen die Engine auf dem Geraet (nur die Schleife 127.0.0.1, verlaesst das Geraet nicht) sowie der Fernzugriff und ein eigener Anbieter im eigenen Netz: beide verbinden das Handy mit einem Geraet des Nutzers, nichts davon erreicht den Entwickler (Pruefersicht S7) |
| Koennen Nutzer die Loeschung ihrer Daten verlangen | Ja: "Delete account" in der App, und im Web unter `{{ACCOUNT_DELETE_URL}}` |
| Datenschutzerklaerung | `{{PRIVACY_URL}}` |

Datentypen:

| Datentyp im Formular | Was genau | Erhoben | Geteilt | Zweck | Pflicht oder freiwillig |
|---|---|---|---|---|---|
| Persoenliche Daten: E-Mail-Adresse | Anmeldung bei LU Cloud | Ja | Nein | App-Funktionen, Kontoverwaltung | freiwillig (die App laeuft ohne Konto) |
| Persoenliche Daten: Nutzer-IDs | Kennung des Kontos an jedem Cloud-Aufruf | Ja | Nein | App-Funktionen, Kontoverwaltung | freiwillig |
| Nachrichten: sonstige In-App-Nachrichten | Prompts und Antworten im Cloud-Modus, Text zum Vorlesen ueber LU Cloud (`src/api/voice.ts`, `/api/voice/tts`; ergaenzt in Runde 33) | Ja | Nein | App-Funktionen | freiwillig, erst nach der Einwilligung |
| Fotos und Videos | Bilder und Videos als Quelle eines Cloud-Auftrags in Create | Ja | Nein | App-Funktionen | freiwillig |
| Audio: Sprach- oder Tonaufnahmen | Diktat ueber LU Cloud | Ja | Nein | App-Funktionen | freiwillig |
| Dateien und Dokumente | angehaengte Dateien im Cloud-Modus | Ja | Nein | App-Funktionen | freiwillig |
| App-Aktivitaet: sonstige nutzergenerierte Inhalte | Erinnerungen (Abgleich), Inhaltsmeldung mit Ausschnitt bis 500 Zeichen | Ja | Nein | App-Funktionen | freiwillig |
| App-Aktivitaet: App-Interaktionen | Zaehler des Cloud-Schalters: Richtung, Plattform, App-Version. Kein Konto, keine Geraetekennung | Ja | Nein | Analysen | abschaltbar unter Privacy, ab Werk an |

Nicht erhoben: Standort, Kontakte, Kalender, Zahlungsdaten, Gesundheitsdaten, Browserverlauf, Geraetekennungen, Absturzberichte.

Zwei Punkte, die nur David beantworten kann:

1. "Geteilt": Die App sagt in der Einwilligung, dass Inhalte an LU Cloud und an die KI-Dienstleister gehen, die dessen Modelle betreiben. Google zaehlt eine Weitergabe an Dienstleister, die im Auftrag verarbeiten, nicht als Teilen. Ob jeder dieser Dienstleister vertraglich ein Auftragsverarbeiter ist, weiss nur David. Wenn nicht: je Zeile "Geteilt: Ja".
2. Der Zaehler gilt nur als nicht personenbezogen, wenn der Server dazu keine IP-Adresse oder Aehnliches ablegt (`FUER-DAVID.md`, Kurzliste). Bitte am Server gegenpruefen.

## 8. Hinweise fuer die Pruefer (Konsole, App-Zugriff)

Auswahl in der Konsole: "Alle oder einige Funktionen sind eingeschraenkt", mit dem Testkonto unten und diesem Text als Anleitung.

```store play.review max=4000
LU works without an account. Everything below under "Without an account" can be tested on a phone with no sign in.

WITHOUT AN ACCOUNT
1. Open the app. It asks "Are you 18 or older?". Tap "Yes, I am 18 or older".
2. The setup shows "Pick a starter model". Pick the model marked "Recommended" and tap "Download". Starter models start at about 400 MB, so use Wi-Fi.
3. Tap "Use this model", finish the setup and send a message in the Chat tab. The answer is written by the model on the phone. You can switch on airplane mode before you send it: the chat still answers.
4. Every answer has a "Report" action. Open it to see how content is reported. Reports go to the LU team.
5. Models tab: the catalogue, each model with a note on whether it fits this phone.

WITH THE TEST ACCOUNT
Settings, Account, sign in with:
Email: {{REVIEW_ACCOUNT_EMAIL}}
Password: {{REVIEW_ACCOUNT_PASSWORD}}
Before the first message to LU Cloud the app shows "LU Cloud processes your content" and waits for "Agree and continue".
• Chat: turn on the Cloud switch and pick a hosted model.
• Create tab: type a prompt and make an image.
• Settings, Account, "Delete account" removes the account. Please do not delete the test account.

GOOD TO KNOW
• The app sells nothing. It shows one sentence without a link: "Plans and credits are available on lu-labs.ai."
• Remote desktop needs LU on a computer in the same network. It cannot be tested without that computer and is not needed for anything else.
• The app asks for the microphone only when you start dictation, and for notifications only when a download starts.
• Contact: {{SUPPORT_EMAIL}}
```

Der Weg ohne Konto ist im Emulator belegt (erster Start bis zur lokalen Antwort, `ABNAHME.md`), nicht auf einem echten Geraet. Schritt 4: Der Meldeknopf sitzt seit Runde 3 direkt an der Antwort, am Geraet ist das noch nachzupruefen (`STORE-BAUSTEINE.md`, bekannte Grenzen). Vor dem Einreichen einmal am echten Handy durchgehen und die Schritte anpassen, falls ein Wortlaut abweicht.

## 9. Grafiken und Screenshots

Alle Bilder aus dem Play-Bau (Preset `play`) aufnehmen, damit kein Bild etwas zeigt, das der Bau nicht hat. Keine Statusleiste mit echten Namen, kein echtes Konto, keine Preise im Bild. Ablage: `release-assets/play/` ausserhalb des Repos oder unter `mobile-docs/store/bilder/play/`, die Dateinamen wie unten.

Pflicht:

| Datei | Was | Mass |
|---|---|---|
| `play-icon-512.png` | App-Icon | 512 x 512, PNG, 32 Bit |
| `play-feature-1024x500.png` | Vorstellungsgrafik (Feature Graphic) | 1024 x 500, PNG oder JPG, ohne Transparenz |

Telefon (Pflicht, mindestens 2, hoechstens 8, Hochformat 1080 x 1920 oder groesser, Seitenverhaeltnis 9:16):

| Datei | Bildschirm | Zustand |
|---|---|---|
| `play-phone-01-chat.png` | Chat (`/chat/:id`) | eine Antwort eines Modells auf dem Geraet, Modellname oben sichtbar |
| `play-phone-02-models.png` | Models (`/models`) | Katalog mit den Passungs-Hinweisen ("Should run well on this phone") |
| `play-phone-03-documents.png` | Chat mit Dokument | eine Frage an ein angehaengtes Dokument, Quelle unter der Antwort |
| `play-phone-04-agent.png` | Chat im Agent-Modus | ein Werkzeugschritt mit Rueckfrage zur Erlaubnis |
| `play-phone-05-create.png` | Create (`/create`) | ein erzeugtes Bild, unverfaenglich, mit dem Testkonto |
| `play-phone-06-privacy.png` | Settings, Privacy | die Seite mit dem Satz zum Zaehler und dem Schalter |
| `play-phone-07-remote.png` | Chats, Segment Remote desktop | verbunden mit einem Rechner (nur Play, im App Store gibt es das nicht) |

Tablet (freiwillig, nur wenn die App fuer Tablets beworben werden soll; heute ist sie fuer Telefone gebaut):

| Datei | Geraet | Mass |
|---|---|---|
| `play-tablet7-01-chat.png`, `play-tablet7-02-models.png` | 7 Zoll | 1200 x 1920 |
| `play-tablet10-01-chat.png`, `play-tablet10-02-models.png` | 10 Zoll | 1600 x 2560 |

## 10. Was vor dem Einreichen noch offen ist

Steht in `RELEASE-KNOPF.md`, Abschnitt "Nach dem Upload".
