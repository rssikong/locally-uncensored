# App Store: Store-Eintrag

Stand 10.10.2026, nachgezogen am 14.10.2026 (Runde 28: Anmeldewege, Filterangaben, Einwilligung, Paket 11). Gilt fuer das Paket aus `scripts/mobile/release/ios-appstore.sh` (Preset `appstore`). Dieses Preset ist das engste: fester Inhaltsfilter ohne Schalter, kein Katalog mit Modellen ohne Ablehnungen, keine fremden Modelldateien, keine eigenen Anbieter, keine Schluesselfelder der Websuche, kein Fernzugriff, keine Kaufflaeche und kein Satz dazu, keine Cloud-Modelle mit der Marke "Direct". Anmeldung mit E-Mail und Passwort, "Sign in with Apple", Google und GitHub (`src/mobile/policy/storePolicy.ts`; die Schluesselfelder und die Anmeldung sind am 10.10.2026 entschieden, `STORE-BAUSTEINE.md` 2.3 und 2.4). Die Texte hier nennen nichts davon.

Die Bloecke mit der Kennung `store` sind die Texte fuer App Store Connect, woertlich zum Kopieren. Der Waechter `src/mobile/__tests__/store-unterlagen.test.ts` prueft sie mit denselben Wortregeln wie die App (`e2e/mobile/store-rules.ts`, Preset `appstore`) und zaehlt die Zeichen. Kennungen in doppelten geschweiften Klammern stehen in `PLATZHALTER.md`.

Keine Preisaussage: Kein Text, den ein Nutzer im Store liest, sagt, was die App oder LU Cloud kostet oder dass etwas nichts kostet. Die eine Ausnahme ist der Block `review` in Abschnitt 9: Er geht nur an die Pruefer und begruendet, warum die App ohne In-App-Kauf auskommt (Richtlinie 3.1.3(f)).

Entschieden am 10.10.2026 (`FUER-DAVID.md`, "Entschieden"): Die App heisst im App Store nur `LU`. Kein Text nennt den langen Namen des Desktop-Produkts, in keiner Schreibweise, und keiner nennt ein Wort ueber Antworten ohne Ablehnungen. Der Waechter haelt beides.

Adressen fuer App Store Connect (Werte in `PLATZHALTER.md`, seit 14.10.2026 alle live):

| Feld | Kennung |
|---|---|
| Support URL (Pflicht) | `{{SUPPORT_URL}}` |
| Marketing URL (freiwillig) | `{{MARKETING_URL}}` |
| Privacy Policy URL | `{{PRIVACY_URL}}` |
| EULA (oder Apples Standard) | `{{TERMS_URL}}` |

## 1. Name und Untertitel (je hoechstens 30 Zeichen)

```store appstore.name max=30
LU
```

```store appstore.subtitle max=30
AI that runs on your iPhone
```

Der Name ist entschieden (`{{APP_NAME_APPSTORE}}`: `LU`, 10.10.2026) und muss im App Store frei sein. Die App nennt sich im Store-Bau ueberall `LU`, auf dem Startbildschirm, in den Berechtigungstexten und in jedem Text der Oberflaeche. Ist `LU` im App Store vergeben, braucht es Davids Wort fuer einen Zusatz; der Untertitel traegt schon, was die App ist.

## 2. Kurzbeschreibung: Werbetext (hoechstens 170 Zeichen)

Der App Store hat keine Kurzbeschreibung wie Google Play. Der Werbetext steht ueber der Beschreibung und laesst sich ohne neue Pruefung aendern.

```store appstore.promo max=170
Chat with AI models that run on your iPhone, without a connection and without an account. Add LU Cloud when you want larger models, images or voice.
```

## 3. Langbeschreibung (hoechstens 4000 Zeichen)

```store appstore.description max=4000
LU is an AI assistant that can run on your iPhone. Download a model once, then chat without a connection and without an account. What you write to an on device model stays on this iPhone.

ON YOUR IPHONE
• Chat with language models that run on the iPhone itself
• A catalogue of models, each marked with how well it fits the memory of your iPhone
• Ask questions about your own documents
• An agent that uses tools such as web search, with a permission for every kind of action
• Memory, personas, workflows and a side by side comparison of two models
• Answers read aloud with the voice of your iPhone

WITH LU CLOUD (OPTIONAL, NEEDS SIGNING IN)
• Larger hosted models for chat
• Create: images and video from a prompt, and your own characters
• Dictation and Cloud voices
LU asks before it sends anything to LU Cloud for the first time. You can take that consent back in the settings.

YOUR DATA
• Chats with on device models stay on the iPhone
• No ads and no tracking across apps
• LU counts one thing: taps on the Cloud switch, with the direction, the platform and the app version. No account, no content, no device ID. You can turn it off under Privacy
• You can delete your account inside the app
• One file backs up all your chats, to keep or to move

SAFETY
• LU is made for adults and asks you to confirm that you are 18 or older
• Every AI answer and every generated image or video has a Report button
• Prompts for images and video in Create are checked against a fixed content filter before they are sent
• AI models make mistakes. Check what matters before you rely on it

WHAT YOU NEED
• iOS 17 or later
• On device models need memory. Before a download LU tells you whether a model fits your iPhone
• A connection once to download a model, and whenever you use LU Cloud

LU is open source under the AGPL-3.0 license.
```

Belege je Aussage wie in `PLAY-EINTRAG.md` Abschnitt 3. Was hier fehlt, fehlt im Bau: eigene Modelldateien (`customModelUrl: false`), Fernzugriff (`remoteDesktop: false`). "Checked against a fixed content filter": `contentLevels: fixed-filter`, Create rechnet hoechstens mit der Stufe Standard. Geprueft wird der Prompt in der App vor dem Hochladen, der Server liest die Obergrenze noch nicht (`STORE-BAUSTEINE.md` 2.1). Der Satz sagt mit Absicht nichts ueber den Chat: weder der Cloud-Chat noch die Modelle auf dem Geraet werden gefiltert (ebenda), ein Satz dazu waere ein Versprechen, das der Bau nicht haelt (Pruefersicht R3). iOS 17: `minimumSystemVersion` in `tauri.ios.conf.json`.

Der Satz zur Lizenz: Im Store-Bau fehlt die Zeile "Source code" (`STORE-BAUSTEINE.md` 8, zweiter Punkt 6). Der Satz nennt keine Adresse. Ob er bleiben soll, entscheidet David.

## 4. Was ist neu (erste Version)

```store appstore.whatsnew max=4000
The first version of LU for iPhone.
```

## 5. Schlagwoerter (hoechstens 100 Zeichen, mit Komma getrennt, ohne Leerzeichen)

```store appstore.keywords max=100
private ai,on device,offline,local models,chat,assistant,documents,voice,image,video,agent,llm
```

Neutrale Schlagwoerter und nichts, was die App deutet: private ai, on device, offline, local models, chat, documents. Keine fremden Markennamen, keine Woerter aus dem Namen (Apple wertet sie doppelt nicht), kein Wort ueber Antworten ohne Ablehnungen.

## 6. Kategorie

- Primaer: Productivity.
- Sekundaer: Utilities.

## 7. Altersfreigabe (Fragebogen in App Store Connect)

Ehrlich nach dem, was das Preset `appstore` wirklich zeigt (`STORE-BAUSTEINE.md` 2.1): Der Katalog enthaelt nur Modelle mit eigenen Ablehnungen, fremde Modelle lassen sich nicht laden, Bilder und Videos in Create laufen hoechstens mit der Stufe Standard. Aber: Die App legt keinen Wortfilter ueber Text. Was ein Modell auf dem Geraet schreibt, haengt am Modell, und der Cloud-Chat wird nicht nach einer Stufe gefiltert (nur die Cloud-Modelle mit dem Kennzeichen "ohne Ablehnungen" fehlen in der Auswahl). Text zu Themen fuer Erwachsene kann also auf Wunsch des Nutzers entstehen.

Die App selbst fragt beim ersten Start nach 18 Jahren. Deshalb der Vorschlag: die Altersfreigabe von Hand auf **18+** anheben (Age Rating Override), gleich was der Fragebogen errechnet. Eine niedrigere Freigabe widerspraeche der eigenen Altersfrage.

| Frage | Antwort | Warum |
|---|---|---|
| Kindersicherung in der App (Parental Controls) | Nein | gibt es nicht |
| Alterspruefung (Age Assurance) | nach der Definition in der Konsole: Die App hat eine erklaerte Altersangabe ("Are you 18 or older?"), keinen Nachweis und keine Schaetzung. Zaehlt die Konsole eine Erklaerung, dann Ja, sonst Nein | `ageGate: declare-18` |
| Uneingeschraenkter Webzugriff | Nein | kein Browser in der App, Links oeffnet Safari |
| Von Nutzern erstellte Inhalte, die andere sehen | Nein | nichts wird zwischen Nutzern geteilt |
| Nachrichten und Chat zwischen Nutzern | Nein | der Chat ist mit einem Modell, nicht mit Menschen |
| Werbung | Nein | keine |
| Themen fuer Erwachsene, anzuegliche Themen | Selten oder mild | Text eines Sprachmodells, vom Nutzer veranlasst |
| Derbe Sprache | Selten oder mild | wie oben |
| Horror und Furcht | Selten oder mild | wie oben |
| Alkohol, Tabak, Drogen (Erwaehnung) | Selten oder mild | wie oben |
| Medizinische Informationen | Selten oder mild | ein Modell beantwortet auch Gesundheitsfragen, die App ist kein Medizinprodukt |
| Gesundheit und Wohlbefinden | Selten oder mild | wie oben |
| Sexuelle Inhalte oder Nacktheit | Selten oder mild | Text auf Wunsch moeglich. Bilder sind gefiltert |
| Drastische sexuelle Inhalte und Nacktheit | **David bestaetigt** | Der Bau bietet kein Modell an, das dafuer gemacht ist, und filtert Bilder. Ob die verbleibenden Cloud-Modelle solchen Text schreiben, weiss nur, wer sie kennt. Im Zweifel "Haeufig oder stark": das Ergebnis ist mit der Anhebung ohnehin 18+ |
| Gewalt, gezeichnet oder Fantasie | Selten oder mild | Text auf Wunsch |
| Realistische Gewalt | Selten oder mild | Text auf Wunsch |
| Anhaltende drastische oder sadistische Gewalt | **David bestaetigt** | wie bei drastischen sexuellen Inhalten |
| Waffen | Selten oder mild | Text auf Wunsch |
| Gluecksspiel, simuliertes Gluecksspiel, Gewinnspiele, Lootboxen | Nein | gibt es nicht |

Die genauen Namen der Fragen aendert Apple gelegentlich. Massgeblich ist die Zeile, nicht der Wortlaut.

## 8. Datenschutz (App Privacy in App Store Connect)

Stand Runde 15 (David, 10.10.2026: Google, GitHub und "Sign in with Apple" im Paket). An den Angaben unten aendert sich nichts: Jede der Anmeldungen ergibt dieselben zwei Datentypen, E-Mail-Adresse und Kennung des Kontos. Bei "Sign in with Apple" fragt die App seit Runde 16 nur nach der E-Mail-Adresse, nicht nach dem Namen (`plugins/lu-native/ios/Sources/AppleSignIn.swift`, `requestedScopes = [.email]`; korrigiert in Runde 33, vorher stand hier, das Blatt frage auch nach dem Namen). Wuerde ein Name je gespeichert, kaeme "Contact Info: Name" dazu, hier und im Manifest. Mit "Hide My Email" ist die E-Mail-Adresse eine Weiterleitungsadresse von Apple; der Datentyp bleibt derselbe. Bitte gegenpruefen: Bei Google und GitHub legt der Kontoserver (Supabase) von sich aus Namen und Bildadresse des Anbieters am Konto ab, die App zeigt keines von beiden. Ob das als "Name" anzugeben ist, ist vor dieser Runde nicht bewertet worden und gilt genauso fuer das Play-Paket. Die Websuche ohne eigene Schluessel ist der Weg, den das Paket schon hatte (die freie Suche, vom Geraet aus), nur ohne die Wahl daneben.

Aus `STORE-BAUSTEINE.md` Abschnitt 9. Dasselbe steht in `src-tauri/gen/apple/locally-uncensored_iOS/PrivacyInfo.xcprivacy`, der Waechter `src/lib/__tests__/ios-privacy-manifest.test.ts` haelt Manifest und Code zusammen. Die Angaben in der Konsole muessen dem Manifest gleichen.

- Datenschutzerklaerung: `{{PRIVACY_URL}}`
- Tracking: Nein (`NSPrivacyTracking` ist `false`).

Mit dem Nutzer verknuepfte Daten (Data Linked to You), Zweck jeweils App Functionality:

| Typ in der Konsole | Was genau | Wann |
|---|---|---|
| Contact Info: Email Address | Anmeldung bei LU Cloud | nur mit Konto |
| Identifiers: User ID | Kennung des Kontos an jedem Cloud-Aufruf | nur mit Konto |
| User Content: Photos or Videos | Bilder und Videos als Quelle eines Cloud-Auftrags in Create | nur im Cloud-Modus |
| User Content: Audio Data | Diktat ueber LU Cloud | nur im Cloud-Modus |
| User Content: Other User Content | Prompts, angehaengte Dateien, Text zum Vorlesen ueber LU Cloud (`src/api/voice.ts`, `/api/voice/tts`), Erinnerungen, Inhaltsmeldung mit Ausschnitt | nur im Cloud-Modus nach der Einwilligung, die Meldung nur wenn der Nutzer meldet |

Nicht mit dem Nutzer verknuepfte Daten (Data Not Linked to You), Zweck Analytics:

| Typ in der Konsole | Was genau |
|---|---|
| Usage Data: Product Interaction | Zaehler des Cloud-Schalters: Richtung, Plattform, App-Version. Kein Konto, keine Geraetekennung. Abschaltbar unter Privacy, ab Werk an |

Offen, nur David:

1. Der Zaehler ist nur dann "nicht verknuepft", wenn der Server dazu keine IP-Adresse oder Aehnliches ablegt (`FUER-DAVID.md`, Kurzliste).
2. Die Inhaltsmeldung traegt einen Ausschnitt ohne Kontobezug. Das Manifest erklaert "Other User Content" einmal und als verknuepft (der strengere Fall). Ob Apple dafuer eine zweite, nicht verknuepfte Angabe will, ist offen (`STORE-BAUSTEINE.md` 9).
3. Offenlegung fremder KI-Dienste nach Richtlinie 5.1.2(i): Seit Runde 28 sagt die Einwilligung, dass LU Cloud Inhalte an "third-party AI providers that run its models" weitergibt, ohne Namen, und verlinkt die Datenschutzerklaerung (`src/mobile/strings/policy.ts`, Waechter `consent-sheet.dom.test.tsx`). Ob Apple Namen verlangt, ist offen (`FUER-DAVID.md` Nr. 10); dann muessten sie zuerst in der Datenschutzerklaerung stehen.

Weitere Angaben in der Konsole:

- Export Compliance: `ITSAppUsesNonExemptEncryption` ist `false`, die Frage erscheint dann nicht. Korrigiert in Runde 33: Die App benutzt nicht nur die Verschluesselung des Systems. HTTPS laeuft auf dem Handy ueber die Rust-Bibliothek rustls (`src-tauri/Cargo.toml`, `reqwest` mit `rustls-tls`), also Standard-TLS ausserhalb des Systems; dazu ChaCha20-Poly1305 aus CryptoKit fuer eigene Ablagedaten (`Seal.swift`). Beides sind Standardverfahren nur fuer Transport und Schutz eigener Daten, `false` ist vertretbar. Begruendung und die strengere Variante: `FORMULARE.md` A4.
- Content Rights: Vorschlag "Yes, it contains, shows, or accesses third-party content, and I have the necessary rights to use it". Korrigiert in Runde 33: Die App laedt Modelle Dritter aus dem Katalog und zeigt Treffer der Websuche, "keine Inhalte Dritter" stimmte nicht (`FORMULARE.md` A1).

## 9. Hinweise fuer die Pruefer (App Review Information, Notes)

Dazu im Formular: "Sign-in required" ankreuzen und das Testkonto eintragen (`{{REVIEW_ACCOUNT_EMAIL}}`, `{{REVIEW_ACCOUNT_PASSWORD}}`), Ansprechperson `{{REVIEW_CONTACT_NAME}}`, `{{REVIEW_CONTACT_EMAIL}}`, `{{REVIEW_CONTACT_PHONE}}`.

```store appstore.review max=4000
LU works without an account. Everything under "Without an account" can be reviewed with no sign in.

WITHOUT AN ACCOUNT
1. Open the app. It asks "Are you 18 or older?". Tap "Yes, I am 18 or older".
2. The setup shows "Pick a starter model". Pick the model marked "Recommended" and tap "Download". Starter models start at about 400 MB, so use Wi-Fi.
3. Tap "Use this model", finish the setup and send a message in the Chat tab. The answer is written by the model on the iPhone. You can switch on Airplane Mode before you send it: the chat still answers.
4. Every answer has a "Report" action. Open it to see how content is reported. Reports go to the LU team.
5. Models tab: the catalogue, each model with a note on whether it fits this iPhone.

WITH THE TEST ACCOUNT
Settings, Account, sign in with the email and password from the sign in fields of this form. The same page offers Sign in with Apple, Continue with Google and Continue with GitHub. Each of them leads to an account of the person who signs in, not to the test account.
Before the first message to LU Cloud the app shows "LU Cloud processes your content" and waits for "Agree and continue".
• Chat: turn on the Cloud switch and pick a hosted model.
• Create tab: type a prompt and make an image.
• Settings, Account, "Delete account" removes the account. Please do not delete the test account.

HOW CONTENT IS HANDLED
• The app asks for a declared age of 18 before anything else.
• Images and video in Create: the app checks the prompt against a fixed content filter before it is sent. This version has no switch that loosens it.
• Chat is not filtered by the app, neither with models on the iPhone nor with LU Cloud. What a model writes depends on the model.
• The catalogue is a fixed list and holds no model that was changed to decline less. This version cannot load other model files, has no model search, and does not list the LU Cloud models that are tuned to decline less.
• Web search uses a built in search. This version has no field for a search key or for a provider of your own.
• Models are data files (weights). The app downloads no executable code.
• Every AI answer and every generated image or video can be reported from inside the app.

GOOD TO KNOW
• The app sells nothing and shows no offers. Signing in is optional. The note on guideline 3.1 follows below.
• Microphone: only when you start dictation or voice chat. Camera: only when you choose to take a photo for a chat or an image request. Photos: only to save an image or video you chose to save.
• Contact: {{SUPPORT_EMAIL}}
```

Der zweite Teil der Hinweise, im selben Feld der Konsole direkt darunter. Er begruendet den Verzicht auf In-App-Kauf und darf deshalb die Woerter des Kaufens nennen; ein Nutzer liest ihn nie. Zusammen bleiben beide Teile unter 4000 Zeichen (der Waechter zaehlt).

```review appstore.review-purchases max=1600
PURCHASES (GUIDELINE 3.1)
• The app is free to download. Everything on the device works without an account and without any payment: downloading models, chat, documents, the agent, memory and reading aloud.
• LU Cloud is a separate, optional, paid web-based service. People who already have an LU Cloud account can sign in and use what that account includes. The app is a free stand-alone companion to that service (guideline 3.1.3(f)).
• There is no purchasing inside the app. The app sells no credits, no plans and no subscriptions, and it unlocks nothing for a payment.
• The app has no call to action for purchase outside of the app: no button, no link and no sentence that says where or how to buy. It shows no prices.
• What it shows is the state of the signed in account: how many credits the account has, and how many credits an action uses. When none are left it says so in one sentence and offers a model on the device.
• The app opens four addresses by itself: the privacy policy, the terms of use, support by email, and the page where an account can be deleted.
• The test account in the sign in fields of this form has credits, so every Cloud function can be reviewed without a payment.
```

Belege je Satz dieses Blocks, am Code des Presets `appstore`: `purchase: 'none'`, `pricingWords: false`, `externalLinks: 'legal-only'` (`src/mobile/policy/storePolicy.ts`); der Waechter `e2e/mobile/store-waechter.mobile.ts` zeichnet jede Seite und jedes Blatt in drei Kontostaenden und findet kein Kaufwort, keinen Preis, keine Adresse der Webseite und keinen Link ausser den vier genannten; Saetze, die vom Server kommen, laufen durch `src/mobile/policy/server-text.ts`. Kontostand und Verbrauch: Seite Account, Blatt "Credits for this answer", Create. Der neutrale Satz bei leerem Guthaben: `SETTINGS_STRINGS.credits.textCreditsPlain`. Falls Apple trotzdem In-App-Kauf verlangt (3.1.3(b)): der Entwurf liegt in `mobile-docs/r15/in-app-kauf.md`, gebaut ist davon nichts.

**Voraussetzung, nur David:** Das Testkonto braucht Guthaben und ein Passwort (`{{REVIEW_ACCOUNT_EMAIL}}`), und die Seite hinter "Delete account in your browser" (`{{ACCOUNT_DELETE_URL}}`) darf nicht selbst zum Kauf auffordern. Erledigt am 14.10.2026: der Link fuehrt auf die eigene Loeschseite der Webseite; sie hat keinen Link zu Preisen und keinen Kaufknopf (abgerufen 14.10.). Sie verlinkt die Anmeldung und die Kontoseite, also einen Schritt weiter Seiten der Webseite, wie es Datenschutz und Bedingungen auch tun.

Der Weg ohne Konto ist im Simulator belegt (erster Start bis zur lokalen Antwort, `ABNAHME.md`), nicht auf einem echten iPhone. Vor dem Einreichen einmal am Geraet durchgehen und die Schritte anpassen, falls ein Wortlaut abweicht.

Anmeldung (David, 10.10.2026, `STORE-BAUSTEINE.md` 2.3): Das Paket bietet E-Mail und Passwort an, dazu "Sign in with Apple", "Continue with Google" und "Continue with GitHub". "Sign in with Apple" steht ueber den beiden anderen und ist die Anmeldung, die Richtlinie 4.8 neben einer Anmeldung ueber Dritte verlangt. Die App ist ohne Konto lokal nutzbar; die Cloud-Funktionen sieht ein Pruefer mit dem Demo-Konto.

Das Demo-Konto ist Pflicht (Richtlinie 2.1): ein Konto mit E-Mail und Passwort, bestaetigt, mit etwas Guthaben, eingetragen in App Store Connect unter "App Review Information" bei "Sign-in required". Es darf keines sein, das nur ueber Google, GitHub oder Apple angelegt wurde: ein Pruefer kann sich mit einem fremden Google- oder Apple-Konto nicht anmelden. Ohne Demo-Konto sieht die Pruefung Chat, Create und das Konto hinter der Anmeldung nicht und lehnt ab.

**Erledigt am Paket 11 (Paketpruefung, `r27/pruefersicht.md` S1):** Die Berechtigungstexte nennen keinen Fernzugriff mehr (kein `NSLocalNetworkUsageDescription`, der Kameratext ohne Fernzugriff), und das Paket meldet nur das iPhone (`UIDeviceFamily` 1). iPad-Screenshots sind daher nicht noetig. Der Kameratext des App-Store-Baus nennt nur das Foto ("LU uses the camera when you choose to take a photo for a chat or an image request."); Quellen `src-tauri/Info.ios.plist` und `Info.ios.fernzugriff.plist`, `pruefe-paket.sh` prueft es an jedem Paket. Die Familie kommt aus `TARGETED_DEVICE_FAMILY` in `src-tauri/gen/apple/project.yml`; Entscheidung fuer die erste Veroeffentlichung, umkehrbar (`FUER-DAVID.md`). Auf einem iPad laeuft die App trotzdem, im iPhone-Fenster, und ein Pruefer darf sie dort oeffnen.

## 10. Screenshots

Alle Bilder aus dem App-Store-Bau (Preset `appstore`) aufnehmen, im Simulator mit sauberer Statusleiste (`scripts/mobile/ios/steuerung.sh`). Kein echtes Konto, keine Preise, kein Android-Geraet im Bild. Ablage: `release-assets/appstore/` ausserhalb des Repos oder unter `mobile-docs/store/bilder/appstore/`, die Dateinamen wie unten.

iPhone 6,9 Zoll (Pflicht, 1320 x 2868, Hochformat, 3 bis 10 Bilder; der Simulator `LU-iOS-gross`, iPhone 17 Pro Max, liefert genau dieses Mass):

| Datei | Bildschirm | Zustand |
|---|---|---|
| `ios-69-01-chat.png` | Chat | eine Antwort eines Modells auf dem Geraet |
| `ios-69-02-models.png` | Models | Katalog mit den Passungs-Hinweisen |
| `ios-69-03-documents.png` | Chat mit Dokument | eine Frage an ein angehaengtes Dokument, Quelle unter der Antwort |
| `ios-69-04-agent.png` | Chat im Agent-Modus | ein Werkzeugschritt mit Rueckfrage zur Erlaubnis |
| `ios-69-05-create.png` | Create | ein erzeugtes Bild, unverfaenglich, mit dem Testkonto |
| `ios-69-06-privacy.png` | Settings, Privacy | die Seite mit dem Satz zum Zaehler und dem Schalter |

iPhone 6,5 Zoll (freiwillig, 1284 x 2778; ohne sie skaliert Apple die Bilder der 6,9 Zoll): dieselben sechs als `ios-65-01-chat.png` bis `ios-65-06-privacy.png`.

Keine iPad-Bilder: das Paket meldet seit Paket 11 nur das iPhone (`UIDeviceFamily` 1). Kommt das iPad spaeter dazu, braucht es drei Bilder in 13 Zoll (2064 x 2752): Chat, Models, Create.

Kein Bild zeigt Fernzugriff, eigene Anbieter oder eine fremde Modelldatei: das gibt es in diesem Bau nicht.

## 11. Was vor dem Einreichen noch offen ist

Steht in `RELEASE-KNOPF.md`, Abschnitt "Nach dem Upload".
