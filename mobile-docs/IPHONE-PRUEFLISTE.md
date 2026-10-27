# LU Mobile: Pruefliste fuer das echte iPhone

Stand: 10.10.2026. Am 10.10. nachgezogen an den zwei Simulator-Berichten `mobile-docs/r6/nachpruefung/ios-gross/BERICHT.md` und `mobile-docs/r9/gegenpruefung/ios-klein/BERICHT.md` (Liste weiter unten). Wege und Texte sind am 08.10. aus den Quellen des Stands `7f0d97f1` abgeschrieben und am 09.10. gegen `mobile/shell` `a15b0b65` berichtigt, wo die Runden 3 bis 6 etwas geaendert haben (Liste gleich unten). Gehoert zu `MOBILE-ZIEL.md`, Abschnitt 5.

**Kurze Fassung:** Wer nur eine Stunde hat, nimmt `mobile-docs/DAVID-GERAETETEST.md`, Teil B. Dort stehen auch alle Schritte mit Konto und Guthaben (Cloud-Antwort, ein Bild, Diktat, Foto an ein Cloud-Modell, Sicherung, Neuinstallation): sie stehen hier nicht noch einmal. Die Liste dort deckt sich in einfacherer Form mit den Schritten 1, 5 und 6 (dort B3, B4), 7 und 9 (B12), 11 und 27 (B11), 12 (B5), 14 und 15 (B8), 18 und 25 (B9, B10) und 28 (B14) hier. Was nur hier steht: Grafikbeschleunigung und Selbsttest (2), Geschwindigkeit je Groesse (3), 30 Sekunden und eine Stunde im Hintergrund (8, 23), Download bei gesperrtem Geraet (10), GitHub bei geschlossener App (13), Anruf beim Vorlesen (16), Speichern in Fotos (17), das zweite Geraet (21, 22), Speicher beim Laden (24), Haptik im Einzelnen (26), Wegwischen direkt nach einer Aenderung (29), Teilen mit echten Zielen (30), der Mac (31), die Groesse des iCloud-Backups (32) und eine Webseite ueber Mobilfunk (33).

Diese Liste deckt genau das ab, was der Simulator nicht belegen kann. Du brauchst keine Kenntnis vom Code. Du brauchst zwei iPhones und ein WLAN. Die Zeiten sind geschaetzt, niemand hat die Liste bisher an einem Geraet abgearbeitet: rund 45 Minuten reine Arbeitszeit am ersten Geraet fuer Teil 1 bis 6 und Teil 9, rund 10 Minuten am zweiten Geraet, 5 Minuten am Mac fuer Teil 10. Dazu kommen Wartezeiten (10 Minuten Dauerlauf, 5 Minuten, ein grosser Download, 1 Stunde), in denen du nur zusiehst oder gar nichts tun musst. Hast du nur ein Geraet, lass Teil 7 offen. Hast du keinen Mac, lass Teil 10 offen.

**Wichtig zum Stand:** Die Handy-Oberflaeche ist gebaut: untere Leiste mit den vier Reitern **Chat, Create, Models, Settings**. Die Wege und die englischen Texte in dieser Liste sind aus dem Quelltext abgeschrieben (`src/mobile/strings/`, `mobile-tests/TABELLE.md`). Niemand ist sie bisher an einem iPhone nachgegangen. Deshalb traegt jeder Schritt den Vermerk **Pfad wird nachgetragen**: er heisst hier "aus dem Quelltext, am Geraet noch nicht bestaetigt". Stimmt ein Weg am Geraet nicht, ist das ein Befund fuer deine Notiz, kein Grund abzubrechen. Der Vermerk verschwindet an einem Schritt, sobald jemand den Weg an der laufenden App nachgegangen ist. Alle Texte der App sind Englisch und stehen hier in Anfuehrungszeichen, so wie du sie sehen sollst.

**Was sich seit dem 08.10. geaendert hat (Runden 3 bis 6), und wo es diese Liste trifft:**

| Was | Heute | Schritte |
|---|---|---|
| Startbild und Startfarben | Das Startbild folgt dem System: hell `#F3F4F6` mit dunklem Logo, dunkel `#141414` mit weissem Logo. Fenster und Seite tragen dieselbe Farbe. Vorher war alles vor dem ersten Bild fest dunkel, im hellen Modus gab es einen schwarzen Schirm von 1 bis 2 Sekunden. Das iPhone haelt das Startbild einer installierten App im Zwischenspeicher: nach einem Update die App loeschen und neu installieren, notfalls das iPhone neu starten. Im Simulator ist die neue Folge noch nie gesehen worden (`mobile-docs/r5/start.md`) | 1, 7, 23, 29 |
| Schema `lu` | Das Schema steht im iOS-Paket (in der ersten Abnahme fehlte es). Ueber `lu://oauth/callback` kommt die Anmeldung zurueck, ueber `lu://remote` ein Verbindungsangebot | 12, 13 |
| Blatt "Finish signing in?" | gibt es nicht mehr. LU schliesst die Anmeldung beim Rueckweg selbst ab. Der Rueckweg wird nur angenommen, wenn kurz zuvor auf diesem iPhone eine Anmeldung begonnen wurde | 12, 13 |
| Rueckkehr aus dem Hintergrund | Den Satz "Paused while LU was in the background." gibt es nicht mehr. Nach einem Ende der App heisst es "LU was closed while answering." mit "Continue". "Continue" schreibt in derselben Antwort weiter, ohne eine Nachricht in deinem Namen. Den Zusatz "Your phone needed the memory." gibt es nicht mehr: die App sagt nicht, warum sie beendet wurde | 5, 8, 9, 23 |
| Geschwindigkeitsschalter fuer Downloads | Auf iOS gibt es keinen. Die Seite "Storage and downloads" zeigt dort keine Zeile "Download speed limit", weil das System den Download selbst traegt. Android hat den Schalter | 10, 27 |
| "Download on Wi-Fi only" | gilt bei jedem Start und bei jedem Fortsetzen, nicht nur beim ersten Tippen | 27 |
| "Online" | haengt am Netz des Systems, nicht mehr an der Erreichbarkeit von lu-labs.ai | 11 |
| QR-Code | Der Code am Rechner enthaelt nur die Adresse. Nach dem Scannen steht die Adresse im Feld, den Passcode tippst du, verbunden wird erst mit "Connect" | 25 |
| Vorlesen | Die Stimme des iPhones liest ohne Konto und ohne Guthaben. Nur die Stimmen von LU Cloud und das Diktat brauchen ein Konto | 14, 15, 16 |
| Hinweisbalken ohne Grafikbeschleunigung | zeigt den ganzen Satz und hat den Knopf "Dismiss" | 2, 22 |
| Dokumentmodell | ueberall "80.2 MB" | 1 |
| Variante eines Modells | Eine andere Packung (zum Beispiel IQ2) heisst nach dem Download wie ihr Modell und behaelt Urteil und Marken | 3 |

**Was sich am 10.10. geaendert hat (Simulator-Berichte, Runden 9 bis 11):**

| Was | Heute | Schritte |
|---|---|---|
| Im Simulator belegt und hier gestrichen | Sperre fuer zu grosse Modelle, Tastatur und Raender mit Dynamic Island, grosse Systemschrift (`ABNAHME.md` Zeilen L2.2, 5.3, 5.4, 5.8). Die Schritte behalten ihre Nummer und tragen den Vermerk "gestrichen" | 4, 19, 20 |
| Leere Seite nach Speicherdruck | Beendet iOS den Teil der App, der die Seite zeichnet, blieb LU bis zum Neustart leer (im Simulator drei von drei Mal). Seit Runde 11 laedt die Seite neu. Am Geraet hat das niemand gesehen: der wichtigste neue Punkt dieser Liste | 7, 9, 23 |
| Neuer Chat und sofortiges Beenden | Ein neuer Chat ging verloren, wenn die App 1 bis 2 Sekunden nach dem ersten Senden beendet wurde. Seit Runde 11 behoben, am Geraet nicht gesehen | 29 |
| "Continue" | setzt seit Runde 10 mitten im Satz fort, ohne doppelten Text. Mit einem Modell aus LU Cloud heisst der Knopf "Regenerate" | 5, 8, 9 |
| Altersfrage im App-Store-Paket | "No" fragt ein zweites Mal ("You said you are under 18", mit "Go back"). Erst die Bestaetigung sperrt, und sie bleibt auch nach dem Loeschen der App | 28 |
| Neu | Groesse des iCloud-Backups, eine Webseite ueber Mobilfunk lesen | 32, 33 |

**Welches Paket du hast (App-Store-Schalter):** Reiter Settings, "About LU", Zeile "Build". Dort steht "Open build" oder "App Store build". Diese Liste ist fuer das offene Paket geschrieben. Im App-Store-Paket ist mit Absicht anders: Die App heisst "LU". Beim ersten Start fragt sie "Are you 18 or older?" ("No" fragt einmal nach, die Bestaetigung sperrt und bleibt gesperrt). Es gibt kein "Remote desktop" im Reiter Chat und in Settings, also entfallen dort Schritt 18 und Schritt 25. Die Seite Account ist in beiden Paketen gleich (David, 10.10.2026): E-Mail und Passwort, "Forgot password?", darunter "Sign in with Apple", "Continue with Google" und "Continue with GitHub". Schritt 12, 13 und 34 gelten also auch dort. Settings, Web search zeigt dort keine Anbieterwahl und keine Schluesselfelder, nur einen Satz ueber die freie Suche und "Test search". Es gibt keine Zeile "Providers", im Reiter Models kein Suchfeld, keinen Import einer Modelldatei und je Modell nur eine Packung. Die Seite LU Cloud zeigt nur "Sign in" und "Not now", keine Tarife. "About LU" hat nur Privacy policy, Terms of use, die Support-Adresse und Licenses. Ein Link `lu://remote` soll dort den Satz "This version of LU does not include Remote desktop." zeigen.

**Was die App nicht zeigt, obwohl es die Liste frueher verlangte:** Es gibt keinen Knopf "Run speed test" (Ersatz: Reiter Models, "Installed", "Benchmark", "Run benchmark"), keine Zeile "Thermal state", keine Zeile "Last memory warning", keine Zeile "Higher memory limit" und keine Akkuanzeige. Wo ein Schritt eines davon brauchte, steht jetzt der Ersatz. Die fehlenden Zeilen stehen als offener Wunsch in `mobile-docs/geruest-wuensche/pruefliste.md`.

**So arbeitest du:** Jeden Schritt der Reihe nach. Kreuze das Feld an, wenn du genau das siehst, was unter "Das musst du sehen" steht. Wenn nicht, kreuze nicht an und schreibe auf, was unter "Wenn nicht" verlangt ist. Rate nicht und beschoenige nichts: ein nicht angekreuzter Schritt mit guter Notiz ist mehr wert als ein angekreuzter, der nicht stimmt. Mach bei jedem Fehler ein Bildschirmfoto (Seitentaste und Lauter zugleich, am Geraet mit Home-Knopf Seitentaste und Home-Knopf zugleich).

**Wo du in der App was findest (laut Quelltext):**

| Was | Weg |
|---|---|
| Diagnose | Reiter Settings, Gruppe "Help", "Troubleshooting", nach unten zum Abschnitt "Diagnostics" |
| Zustand der Engine | Reiter Settings, Gruppe "Models and connections", "On device engine" |
| Geschwindigkeit messen | Reiter Models, Segment "Installed", Zeile "Benchmark", "Run benchmark" |
| Downloads | Reiter Models, "Downloads" |
| Konto | Reiter Settings, Karte ganz oben ("Sign in to LU Cloud" oder deine E-Mail) |
| Vorlesen einschalten | Reiter Settings, "Voice", Schalter "Read aloud" |
| Remote | Reiter Chat, Segment "Remote desktop" neben "On this phone" (nicht im App-Store-Paket) |
| Welches Paket | Reiter Settings, "About LU", Zeilen "Version" und "Build" |
| Nur im WLAN laden | Reiter Settings, "Storage and downloads", Schalter "Download on Wi-Fi only" |

## Vorbereitung

### Geraete

| | Was | Warum |
|---|---|---|
| Geraet A | ein iPhone mit Dynamic Island: iPhone 14 Pro oder neuer, iPhone 15, 16 oder 17. Am besten eines mit 8 GB Arbeitsspeicher (15 Pro, 16, 17). iOS 17 oder neuer. | Grafikbeschleunigung, Geschwindigkeit, Speichergrenze, Dynamic Island |
| Geraet B | ein iPhone mit Home-Knopf. Am besten das **iPhone SE der 2. Generation** (2020, Chip A13), denn es deckt zwei Dinge zugleich ab: Home-Knopf und aelterer Chip. Ein iPhone SE der 3. Generation (2022) deckt nur den Home-Knopf ab. iOS 17 oder neuer. | Bildschirm ohne Notch, aelterer Chip |
| Ersatz fuer den aelteren Chip | iPhone XR, XS, 11, 11 Pro (Chip A12 oder A13), falls Geraet B ein SE der 3. Generation ist | Schritt 22 |

Beide Geraete: Akku ueber 60 Prozent, **nicht am Ladekabel**, Stromsparmodus aus, mindestens 10 GB Speicher frei, im WLAN. Keine Huelle waehrend Schritt 5 und 6 (Waerme).

### Was du sonst brauchst

1. Die Zugangsdaten eines **Testkontos** fuer LU Cloud mit etwas Guthaben. David nennt es dir. Das Konto muss sich mit Google und mit GitHub anmelden koennen. Fuer Schritt 34 brauchst du dazu ein iPhone, das an einem Apple-Konto angemeldet ist (dein eigenes genuegt). Passwoerter tippst nur du selbst ein. Voraussetzung auf der Serverseite: die Rueckadresse `lu://oauth/callback` ist bei Supabase eingetragen (`mobile-docs/FUER-DAVID.md`, Punkt 1). Fehlt sie, scheitern Schritt 12 und 13 im Browser, und das ist dann kein Fehler der App.
2. Einen Computer im selben WLAN, auf dem LU fuer den Desktop laeuft, mit eingeschaltetem Remote Access (dort unter Settings, Remote Access). Du brauchst die angezeigte Adresse und den Passcode. Fuer Schritt 18 und 25. Fuer Schritt 31 brauchst du zusaetzlich einen Mac mit Safari und ein Kabel.
3. Ein zweites Telefon, mit dem du Geraet A anrufen kannst. Nur fuer Schritt 14.
4. Eine Stoppuhr (die Uhr-App auf einem anderen Geraet) und etwas zum Schreiben.
5. Auf jedem Geraet ein eigenes Foto in der Fotos-App.
6. Fuer Schritt 27: eine SIM mit Datenvolumen von mindestens 3 GB oder ein zweites WLAN (zum Beispiel der Hotspot eines anderen Telefons). Hast du beides nicht, bleibt der Schritt offen.
7. Fuer Schritt 28: eine zweite, neuere Baunummer von LU in TestFlight. Gibt es keine, bleibt der erste Teil des Schritts offen.

### Wie die App auf das iPhone kommt

**Weg 1, TestFlight (der einfache Weg):**

1. Installiere die App "TestFlight" aus dem App Store.
2. David schickt dir eine Einladung per E-Mail oder einen Link. Oeffne sie auf dem iPhone und tippe auf "Annehmen", dann auf "Installieren".
3. LU erscheint auf dem Home-Bildschirm.

**Weg 2, Xcode (wenn es noch kein TestFlight gibt):**

1. David oder jemand mit seinem Entwicklerkonto braucht einen Mac mit Xcode und ein Kabel.
2. Auf dem iPhone: Einstellungen, Datenschutz und Sicherheit, Entwicklermodus einschalten, das Geraet startet neu.
3. iPhone anschliessen, "Diesem Computer vertrauen" bestaetigen. Der Mac spielt die App auf. Die Bauanleitung dafuer steht in `mobile-docs/BAUEN.md`, Abschnitt 5.11, kurz auch in `mobile-docs/FUER-DAVID.md`, Punkt 3.
4. Beim ersten Start meldet das iPhone vielleicht "Nicht vertrauenswuerdiger Entwickler". Dann: Einstellungen, Allgemein, VPN und Geraeteverwaltung, dem Entwickler vertrauen.

**Vor Schritt 1 auf jedem Geraet:** Ist LU schon installiert, loesche die App (lange auf das Symbol druecken, "App entfernen", "App loeschen") und installiere sie neu. Die Liste geht von einer frischen Installation aus.

Notiere jetzt:

- Geraet A, Modell und iOS-Version (Einstellungen, Allgemein, Info): ____________________
- Geraet B, Modell und iOS-Version: ____________________
- Version von LU (in TestFlight unter der App, oder spaeter Schritt 1, Zeile "App version"): ____________________
- Installiert ueber: TestFlight / Xcode
- Datum, Uhrzeit, Raumtemperatur geschaetzt: ____________________

---

---

## Teil 1: Die Engine auf dem Geraet (Geraet A, rund 12 Minuten plus 10 Minuten Lauf)

### Schritt 1: Erster Start und Diagnose

Pfad wird nachgetragen. Laut Quelltext: Einrichtung "Get started", "Pick a starter model", "Use this model", "Skip for now", "Start chatting". Dann Reiter Settings, "Troubleshooting", Abschnitt "Diagnostics".

- **Tu das:** Stell das iPhone auf hell. Oeffne LU und sieh auf die ersten zwei Sekunden. Tippe "Get started" (im App-Store-Paket beantworte zuerst "Are you 18 or older?" mit "Yes"). Nimm auf der Seite "Pick a starter model" das Modell, das LU vorschlaegt ("Use this model"), und warte, bis der Download fertig ist. Ueberspringe "Document Chat" mit "Skip for now" und tippe auf "Start chatting". Oeffne dann den Reiter Settings, "Troubleshooting", und rolle zum Abschnitt "Diagnostics".
- **Das musst du sehen:** Beim Start ein helles Startbild mit dunklem Logo und danach die helle App, ohne schwarzen Schirm dazwischen, die Uhr oben immer lesbar. Unter "Diagnostics" die Zeilen "Device", "System", "App version", "Memory", "Memory available to LU", "Storage free", "Storage used by LU", "Text size", "Accelerator", "Model loaded", "Last speed", "Engine self test" und "Last unexpected end". Bei "Device" steht dein iPhone, bei "App version" steht 3.0.5 oder neuer. Die Zahl bei "Memory" passt zu deinem Geraet (ein iPhone mit 8 GB zeigt rund 7,5 GB). "Memory available to LU" ist groesser als 0. Darunter die Knoepfe "Run engine self test", "Copy report", "Share report" und "Refresh".
- **Wenn nicht: notiere** welche Zeile fehlt oder falsch ist, mit Bildschirmfoto. War der Start erst dunkel und dann hell, notiere das eigens und wiederhole den Start einmal im Dunkelmodus (erwartet: durchgehend dunkel). Steht bei "Memory available to LU" eine 0 oder nichts, notiere das eigens: im Simulator ist der Wert immer 0, am Geraet darf er es nicht sein.
- Notiere die Werte: Memory ________ Memory available to LU ________ Storage free ________ Accelerator ________
- [ ] Schritt 1 bestanden

### Schritt 2: Grafikbeschleunigung laeuft, die Antwort ist richtiger Text

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat, "New chat", Feld "Message", "Send". Zustand: Reiter Settings, "On device engine", Zeile "Runs on". Selbsttest: "Troubleshooting", "Run engine self test".

- **Tu das:** Oeffne den Reiter Chat, "New chat". Schreibe: `Count from 1 to 20, then write three sentences about the sea.` und sende. Lies die Antwort. Oeffne danach Settings, "On device engine" und lies die Zeilen ganz oben. Geh dann zu Settings, "Troubleshooting", "Diagnostics" und tippe auf "Run engine self test". Lass LU dabei offen.
- **Das musst du sehen:** Die Antwort zaehlt von 1 bis 20 und enthaelt drei lesbare englische Saetze. Auf der Seite "On device engine" steht der Zustand "Running", und bei "Runs on" steht "Graphics acceleration". Das ist die **GPU** des iPhones. In "Diagnostics" steht bei "Accelerator" ebenfalls "Graphics acceleration". Der Selbsttest meldet "Passed with graphics acceleration, N tokens per second." mit einer Zahl groesser als 0. Nirgends steht der Hinweis "Graphics acceleration is not available. LU is running on the processor, which is slower."
- **Wenn nicht: notiere** den genauen Text der Antwort (Bildschirmfoto), was bei "Runs on" und "Accelerator" steht ("Graphics acceleration", "Processor" oder "Processor, graphics acceleration failed the self test"), den Wortlaut des Selbsttests, und ob der Hinweis da ist. Eine Antwort aus lauter gleichen Zeichen (zum Beispiel viele Ausrufezeichen) ist ein schwerer Fehler: sofort notieren, mit Bildschirmfoto.
- Runs on: ____________________ Selbsttest im Wortlaut: ____________________
- [ ] Schritt 2 bestanden

### Schritt 3: Geschwindigkeit je Modellgroesse

Pfad wird nachgetragen. Laut Quelltext: Reiter Models, Segment "Get new" zum Laden, Segment "Installed", Zeile "Benchmark" ("Measure speed on this phone"), "Run benchmark". Den frueher genannten Knopf "Run speed test" gibt es in der App nicht.

- **Tu das:** Lade im Reiter Models unter "Get new" je ein Modell aus drei Groessen, immer nur eines, das mit "Should run well on this phone" markiert ist: ein kleines (rund 1B, zum Beispiel Llama 3.2 1B), ein mittleres (rund 2B, zum Beispiel Qwen 3.5 2B), ein grosses (rund 4B, zum Beispiel Qwen3 4B Instruct). Fuer jedes: Modell antippen, "Use in chat", dann zurueck zu Models, "Installed", "Benchmark", "Run benchmark". Warte, bis das Ergebnis steht. Lass das Geraet zwischen zwei Messungen eine Minute liegen.
- **Das musst du sehen:** Je Modell die Angabe "Measured on this phone" mit einer Zeile der Form "N tokens per second, first word after X". Die Zahl ist groesser als 0. Das kleine Modell ist schneller als das grosse. In "Diagnostics" steht danach bei "Last speed" dieselbe Zahl mit "measured with" und dem Namen des Modells.
- **Wenn nicht: notiere** welches Modell keine Zahl liefert und was stattdessen steht. Gibt es auf deinem Geraet kein passendes grosses Modell, schreibe "nicht passend" in die Zeile, das ist kein Fehler.

| Groesse | Name des Modells | Tokens pro Sekunde | Zeit bis zum ersten Wort | Accelerator |
|---|---|---|---|---|
| klein | | | | |
| mittel | | | | |
| gross | | | | |

- [ ] Schritt 3 bestanden

### Schritt 4: Ein zu grosses Modell ist gesperrt

**Gestrichen am 10.10.2026:** im Simulator belegt (`ABNAHME.md` Zeile L2.2 und 4.4). Nur noch machen, wenn Zeit bleibt. Die Nummer bleibt, damit die Verweise stimmen.

Pfad wird nachgetragen. Laut Quelltext: Reiter Models, Segment "Get new", Filter "Fits this phone" ausschalten.

- **Tu das:** Oeffne Models, "Get new". Schalte den Filter "Fits this phone" aus. Suche ein Modell mit dem Text "Too large for this phone". Tippe es an.
- **Das musst du sehen:** Das Modell hat keinen Knopf zum Herunterladen. Die Detailseite erklaert in ganzen Saetzen, wie viel Speicher das Modell braucht und wie viel dein iPhone hat, und bietet "Pick a smaller model" an. Es startet kein Download.
- **Wenn nicht: notiere** den Namen des Modells und was passiert ist. Hat ein Download begonnen, brich ihn ab und notiere das als schweren Fehler. Zeigt dein Geraet kein einziges zu grosses Modell, notiere "kein zu grosses Modell im Katalog" und die Zahl bei Memory aus Schritt 1.
- [ ] Schritt 4 bestanden

### Schritt 5: Speichergrenze, groesstes passendes Modell, 10 Minuten am Stueck

Pfad wird nachgetragen. Laut Quelltext: Reiter Models, Modell antippen, "Use in chat". Dann Reiter Chat, "New chat".

- **Tu das:** Notiere zuerst Akkustand und Uhrzeit. Waehle das groesste Modell, das noch als "Should run well on this phone" oder "Tight fit, may be slow" markiert ist ("Use in chat"). Oeffne einen neuen Chat. Schreibe: `Write a long story about a lighthouse keeper. At least 1500 words.` Wenn die Antwort fertig ist, schreibe sofort: `Continue the story with another 1500 words.` Wiederhole das, bis 10 Minuten um sind. Lass LU die ganze Zeit im Vordergrund und den Bildschirm an.
- **Das musst du sehen:** LU bleibt die ganzen 10 Minuten offen. Die App schliesst sich nicht von selbst und springt nicht auf den Home-Bildschirm. Jede Antwort ist lesbarer Text. Alle frueheren Nachrichten stehen noch im Verlauf.
- **Wenn nicht: notiere** die Minute, in der LU verschwunden ist, das Modell, und was du nach dem erneuten Oeffnen siehst. Erwartet ist dann der Hinweis "LU was closed while answering" mit dem Text "The answer is saved up to that point." und den Knoepfen "Continue answer", "Open chat" und "Dismiss". Tippst du auf "Continue answer", waechst dieselbe Antwort weiter. Notiere, ob er da ist und ob die halbe Antwort gespeichert wurde. In "Diagnostics" steht dann bei "Last unexpected end" ein Eintrag: schreib ihn ab.
- Modell: ____________________ markiert als: ____________________
- [ ] Schritt 5 bestanden

### Schritt 6: Waerme und Akku nach dem Dauerlauf

Derselbe Lauf wie Schritt 5, du wertest ihn nur aus. Pfad wird nachgetragen. Laut Quelltext: Reiter Models, "Installed", "Benchmark". Eine Zeile "Thermal state" hat die App nicht, die Waerme beurteilst du mit der Hand und am Verhalten des iPhones.

- **Tu das:** Direkt nach den 10 Minuten: Fass die Rueckseite an. Notiere den Akkustand. Oeffne Models, "Installed", "Benchmark" und tippe auf "Run benchmark" mit demselben Modell wie in Schritt 5. Lies danach in "Diagnostics" die Zeile "Last speed".
- **Das musst du sehen:** Das Geraet ist warm, aber du kannst es ohne Unbehagen halten. Das iPhone hat keine Temperaturwarnung gezeigt und den Bildschirm nicht von selbst abgedunkelt. Der Akku hat in 10 Minuten hoechstens 8 Prozentpunkte verloren. Die Geschwindigkeit liegt nicht unter der Haelfte des Wertes aus Schritt 3 fuer dasselbe Modell, oder, wenn das Modell dort nicht gemessen wurde, nicht unter der Haelfte der Zahl aus dem Selbsttest in Schritt 2.
- **Wenn nicht: notiere** alle Werte auch dann, wenn sie schlechter sind. Eine Temperaturwarnung des iPhones ist ein schwerer Befund: Bildschirmfoto.
- Akku vorher ____ % nachher ____ % Tokens pro Sekunde nach dem Lauf ________ Rueckseite: kuehl / warm / heiss. Bildschirm von selbst dunkler: ja / nein
- [ ] Schritt 6 bestanden

### Schritt 7: Speicherdruck durch andere Apps

Pfad wird nachgetragen. Laut Quelltext: Hinweise erscheinen im Chat ueber dem Eingabefeld und auf der Seite "On device engine". Eine Zeile "Last memory warning" hat die App nicht.

- **Tu das:** Das grosse Modell aus Schritt 5 ist noch geladen. Wechsle zum Home-Bildschirm. Oeffne die Kamera und nimm 30 Sekunden Video in der hoechsten Aufloesung auf. Oeffne danach nacheinander Karten, Safari mit einer bildreichen Seite und die Fotos-App. Kehre nach insgesamt rund 2 Minuten zu LU zurueck.
- **Das musst du sehen:** Einen von zwei guten Ausgaengen. Entweder ist LU noch da wie verlassen, und eine neue Frage wird sofort beantwortet. Dabei darf der Hinweis "This phone is low on memory. LU may unload the model." stehen. Oder LU zeigt "The model was unloaded to free memory." mit dem Knopf "Load again", und nach dem Tippen darauf antwortet das Modell wieder. In beiden Faellen ist der Chat vollstaendig. In keinem Fall zeigt LU eine leere Seite: bleibt nach der Rueckkehr nur die leere Flaeche mit der Statusleiste stehen, warte 10 Sekunden, mach ein Bildschirmfoto und notiere, ob die Seite von selbst wiederkam.
- **Wenn nicht: notiere** ob LU neu gestartet ist (Startbild zu sehen), ob der Chat noch da ist, und ob ein Hinweis erklaert, was passiert ist. Ein Neustart ohne jeden Hinweis ist ein Fehler. Ein Neustart mit dem Hinweis aus Schritt 5 ist kein Fehler, aber notiere ihn und schreib die Zeile "Last unexpected end" aus "Diagnostics" ab.
- Ausgang: unveraendert / unveraendert mit Warnhinweis / Modell entladen mit Hinweis / Neustart mit Hinweis / Neustart ohne Hinweis / leere Seite, kam wieder / leere Seite, blieb
- [ ] Schritt 7 bestanden

---

## Teil 2: Hintergrund und Downloads (Geraet A, rund 6 Minuten plus 5 Minuten Warten)

Wechsle fuer diesen Teil zurueck auf das mittlere Modell aus Schritt 3. Pruefe vorher unter Settings, "On device engine", dass der Schalter "Unload when LU is in the background" so steht, wie die App ihn ausliefert, und notiere seine Stellung: an / aus.

### Schritt 8: App wechseln waehrend der Antwort, 30 Sekunden

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat, laufende Antwort mit der Zeile "Answering" und einer Uhr.

- **Tu das:** Schreibe im Chat: `Write 800 words about the history of bread.` Sobald die ersten Zeilen erscheinen, wische zum Home-Bildschirm und oeffne die Uhr-App. Warte 30 Sekunden. Kehre zu LU zurueck.
- **Das musst du sehen:** Der Teil der Antwort, der vor dem Wechsel da war, steht noch da. Dazu einer von drei guten Ausgaengen: Die Antwort ist fertig oder laeuft weiter. Oder unter der Antwort steht "The model on this phone was interrupted" mit "The part that arrived is kept." und einem Knopf zum Weitermachen. Oder, wenn das iPhone LU beendet hat, steht "LU was closed while answering." mit "The part that arrived is kept. Continue goes on from there." und dem Knopf "Continue". Nach "Continue" waechst dieselbe Antwort weiter. Eine neue Frage wird ebenfalls beantwortet. Welcher der drei Ausgaenge am iPhone eintritt, hat noch niemand gesehen.
- **Wenn nicht: notiere** ob die Teilantwort fehlt, ob die Antwort abgebrochen ist und kein Hinweis es sagt, ob "Continue" nichts tut oder die Fortsetzung als zweite Antwort unter einer Nachricht in deinem Namen erscheint. Notiere in jedem Fall, welcher Ausgang eintrat.
- [ ] Schritt 8 bestanden

### Schritt 9: Dasselbe mit 5 Minuten

- **Tu das:** Wiederhole Schritt 8 mit einer neuen Frage, warte aber 5 Minuten, bevor du zurueckkehrst. Nutze das iPhone in der Zeit normal (Nachrichten lesen, eine Webseite oeffnen).
- **Das musst du sehen:** Dasselbe wie in Schritt 8. Zusaetzlich: Die naechste Antwort beginnt innerhalb von 10 Sekunden, das Modell musste also nicht neu geladen werden, oder LU sagt klar, dass es neu laedt ("Loading" mit dem Modellnamen).
- **Wenn nicht: notiere** wie lange es bis zur naechsten Antwort dauert, ob eine Fehlermeldung kommt, und ob LU neu gestartet ist. Wenn die App nach der Rueckkehr gar nicht mehr antwortet, bis du sie schliesst und neu oeffnest, ist das ein schwerer Fehler.
- Sekunden bis zur naechsten Antwort: ________
- [ ] Schritt 9 bestanden

### Schritt 10: Download laeuft weiter, wenn die App zu ist und das Geraet gesperrt

Pfad wird nachgetragen. Laut Quelltext: Reiter Models, "Get new", Modell laden, dann "Downloads".

- **Tu das:** Starte im Reiter Models den Download eines Modells mit mindestens 2 GB, das du noch nicht hast. Oeffne "Downloads". Warte, bis rund 10 Prozent geladen sind, und notiere die Prozentzahl. Schliesse LU ganz: vom unteren Rand nach oben wischen und halten, dann die Karte von LU nach oben wegwischen. Sperre das iPhone mit der Seitentaste. Lass es 3 Minuten liegen. Entsperre, oeffne LU, oeffne Models, "Downloads".
- **Das musst du sehen:** Der Download ist weiter als beim Schliessen oder fertig. In der Zeile steht "Resumed after restart", "Downloading" oder "Installed". Er hat nicht bei 0 neu begonnen. Unten auf der Seite steht der Satz "Downloads keep running when you leave LU and pick up again after a restart." Ist der Download fertig, laesst sich das Modell mit "Use in chat" waehlen und antwortet im Chat.
- **Wenn nicht: notiere** Prozent vorher und nachher, und den Text in der Zeile. Steht der Download bei derselben Zahl wie beim Schliessen, notiere das genau so: dann laeuft er im Hintergrund nicht. Steht dort "Download interrupted" mit "Resume", tippe darauf und notiere, ob er an der alten Stelle weitermacht.
- Prozent beim Schliessen ____ Prozent nach 3 Minuten ____ Text der Zeile: ____________________
- [ ] Schritt 10 bestanden

### Schritt 11: Flugmodus mitten im Download

Pfad wird nachgetragen. Laut Quelltext: Reiter Models, "Downloads".

- **Tu das:** Laeuft der Download aus Schritt 10 noch, nimm ihn. Sonst starte einen neuen. Bleib auf der Seite "Downloads". Oeffne das Kontrollzentrum (von oben rechts nach unten wischen) und schalte den Flugmodus ein. Achte darauf, dass auch WLAN aus ist. Warte 20 Sekunden. Schalte den Flugmodus wieder aus und warte, bis das WLAN verbunden ist.
- **Das musst du sehen:** Im Flugmodus steht in der Zeile "Waiting for network" oder "Download interrupted" mit der erreichten Prozentzahl und dem Knopf "Resume". Die App bleibt bedienbar. Nach dem Ausschalten laeuft der Download von selbst oder nach einem Tippen auf "Resume" an der alten Stelle weiter, nicht bei 0. Vor dem Ende steht kurz "Verifying". Am Ende ist das Modell nutzbar.
- **Wenn nicht: notiere** den Text in der Zeile im Flugmodus, ob der Download bei 0 neu beginnt, und ob das fertige Modell im Chat antwortet. Ein fertiges Modell, das nur Unsinn schreibt oder sich nicht laden laesst, ist ein schwerer Fehler (beschaedigte Datei). Laedt die App gar nichts mehr, obwohl das WLAN wieder da ist, notiere das als Fehler (seit Runde 3 haengt "online" am Netz des Systems, nicht mehr an lu-labs.ai).
- [ ] Schritt 11 bestanden

---

## Teil 3: Anmelden ueber den Browser (Geraet A, rund 4 Minuten)

In beiden Paketen. Das App-Store-Paket hat die zwei Knoepfe wieder (David, 10.10.2026), und ueber ihnen steht "Sign in with Apple" (Schritt 34 in Teil 11).

### Schritt 12: Mit Google anmelden, LU bleibt dabei offen

Pfad wird nachgetragen. Laut Quelltext: Reiter Settings, Karte oben "Sign in to LU Cloud", Seite "Account", "Continue with Google". Nach dem Quelltext schliesst LU die Anmeldung beim Rueckweg selbst ab, ohne Rueckfrage.

- **Tu das:** Oeffne Settings, tippe auf "Sign in to LU Cloud", dann auf "Continue with Google". Der Browser oeffnet sich. Melde dich mit dem Testkonto an. Schliesse LU dabei nicht.
- **Das musst du sehen:** Solange der Browser offen ist, steht in LU "Waiting for your browser. Finish signing in there, then come back to LU." Nach der Anmeldung fragt das iPhone, ob die Seite in LU geoeffnet werden darf, oder es wechselt von selbst zu LU. Danach zeigt die Seite "Account" die E-Mail des Testkontos, den Tarif und "Sign out", ohne dass du noch etwas bestaetigen musst.
- **Wenn nicht: notiere** wo es haengen bleibt: im Browser (welche Seite, welche Meldung, Bildschirmfoto), bei der Rueckkehr (kommt die Frage zum Oeffnen), oder in LU (weiter "Waiting for your browser", oder weiter abgemeldet). Ein Blatt "Finish signing in?" gibt es seit Runde 3 nicht mehr. Erscheint es doch, notiere das mit Bildschirmfoto.
- [ ] Schritt 12 bestanden

### Schritt 13: Mit GitHub anmelden, LU ist dabei geschlossen

Pfad wird nachgetragen. Laut Quelltext: Settings, Karte oben, Seite "Account", "Sign out". Dann "Continue with GitHub". Ob die Anmeldung einen Kaltstart uebersteht, ist an keinem Geraet und in keinem Simulator belegt.

- **Tu das:** Melde dich in LU ab (Settings, Karte oben, "Sign out"). Tippe auf "Sign in to LU Cloud", dann "Continue with GitHub". Sobald der Browser offen ist und **bevor** du dich anmeldest: Oeffne den App-Umschalter und wische die Karte von LU nach oben weg. Geh zurueck in den Browser und melde dich mit dem Testkonto an.
- **Das musst du sehen:** Das iPhone startet LU neu. Nach dem Start bist du angemeldet: die Karte oben in Settings zeigt die E-Mail des Testkontos. Chats und Modelle sind unveraendert da.
- **Wenn nicht: notiere** ob LU startet, aber nichts von der Anmeldung weiss (weiter abgemeldet). Das ist hier der wahrscheinlichste Fehler: LU nimmt den Rueckweg nur an, wenn kurz zuvor eine Anmeldung begonnen wurde, und ob dieses Wissen das Wegwischen uebersteht, zeigt erst dieser Schritt. Pruefe dann: Schliesse LU und oeffne es noch einmal von Hand. Bist du jetzt angemeldet? Notiere ja oder nein.
- Falls Zeit ist, tausche die beiden Anbieter: Google bei geschlossener, GitHub bei offener App. Ergebnis: ____________________
- [ ] Schritt 13 bestanden

---

## Teil 4: Ton (Geraet A, rund 5 Minuten)

Du bist angemeldet. Schalte Cloud ein (Schalter "Cloud", Rueckfrage "Switch to Cloud?", dann "Switch to Cloud"). Kommt beim ersten Mal die Seite "LU Cloud processes your content", lies sie und tippe auf "Agree and continue". Waehle ein guenstiges Modell. Schalte unter Settings, "Voice" den Schalter "Read aloud" ein, er ist am Anfang aus. Das Diktat und die Stimmen von LU Cloud kosten Guthaben: jeden Schritt nur so oft, wie er hier steht. Die Stimme des iPhones ("Default voice of this phone") liest ohne Konto und ohne Guthaben. Notiere bei Schritt 15, welche Stimme gewaehlt war.

### Schritt 14: Mikrofon mit echtem Ton

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat, im leeren Eingabefeld das Mikrofon ("Dictate"). Es teilt sich den Platz mit "Send" und ist nur bei leerem Feld da.

- **Tu das:** Oeffne einen Chat. Tippe bei leerem Eingabefeld auf das Mikrofon. Beim ersten Mal fragt das iPhone nach der Erlaubnis. Lies den Text des Dialogs, dann "Erlauben". Sprich deutlich: "The quick brown fox jumps over the lazy dog." Tippe auf "Tap to stop".
- **Das musst du sehen:** Der Dialog des iPhones nennt LU und enthaelt den Satz "LU records your voice when you start dictation or voice chat. The recording is sent to LU Cloud to be turned into text." Waehrend der Aufnahme bewegt sich ein Pegel, und der Knopf heisst "Tap to stop". Oben am Bildschirm zeigt das iPhone den orangen Punkt. Nach dem Stoppen steht kurz "Writing down what you said", dann steht dein Satz als Text im Eingabefeld, bis auf Kleinigkeiten richtig. Der orange Punkt verschwindet.
- **Wenn nicht: notiere** ob der Dialog kam, was im Eingabefeld steht (leer, falscher Text), ob der Pegel sich bewegt hat, und ob der orange Punkt nach dem Stoppen bleibt (dann laeuft das Mikrofon weiter: schwerer Fehler). Ist kein Mikrofon zu sehen, lies unter Settings, "Voice" die Zeile zum Diktat und schreib sie ab.
- [ ] Schritt 14 bestanden

### Schritt 15: Vorlesen ueber den Lautsprecher, Stummschalter aus und an

Pfad wird nachgetragen. Laut Quelltext: an der Antwort "Read aloud", waehrend des Vorlesens "Stop reading". Ob Vorlesen bei Stummschalter hoerbar sein soll, ist eine offene Entscheidung (`geruest-wuensche/pruefliste.md`, Abschnitt 4). Diese Liste nimmt an: ja.

- **Tu das:** Lautstaerke auf die Haelfte, keine Kopfhoerer verbunden, Stummschalter aus (kein Rot am Schalter, beim iPhone 15 Pro und neuer: Aktionstaste oder Kontrollzentrum, Glocke nicht durchgestrichen). Sende im Chat: `Write six sentences about rain.` Tippe an der Antwort auf "Read aloud". Nach dem zweiten Satz schalte den Stummschalter **ein**. Hoere bis zum Ende.
- **Das musst du sehen:** Die Stimme kommt aus dem Lautsprecher unten, nicht leise aus dem Hoerer oben. Der Knopf heisst waehrend des Vorlesens "Stop reading". Nach dem Umlegen des Stummschalters liest die Stimme weiter und bleibt hoerbar. Am Ende heisst der Knopf wieder "Read aloud".
- **Wenn nicht: notiere** aus welchem Lautsprecher der Ton kommt, und ob er beim Umlegen des Stummschalters verstummt. Verstummt er, ist das kein Absturz, aber notiere es genau so: "stumm bei Stummschalter an". Bleibt es von Anfang an still, pruefe die Lautstaerke und notiere "kein Ton". Erscheint das Blatt "Read aloud is switched off", war der Schalter unter Settings, "Voice" nicht an.
- Ton bei Stummschalter aus: ja / nein. Ton bei Stummschalter an: ja / nein.
- [ ] Schritt 15 bestanden

### Schritt 16: Anruf waehrend des Vorlesens

Pfad wird nachgetragen. Laut Quelltext: wie Schritt 15.

- **Tu das:** Stummschalter aus. Sende: `Write twelve sentences about mountains.` Tippe auf "Read aloud". Ruf Geraet A nach dem ersten Satz mit dem zweiten Telefon an. Nimm an, sprich 10 Sekunden, leg auf. Kehre zu LU zurueck.
- **Das musst du sehen:** Sobald es klingelt, hoert das Vorlesen auf. Waehrend des Gespraechs ist die Stimme von LU nicht zu hoeren. Nach dem Auflegen ist LU bedienbar, der Chat ist da. Der Knopf steht auf "Read aloud" (dann startet ein Tippen das Vorlesen neu) oder das Vorlesen laeuft von selbst weiter. Beides ist in Ordnung.
- **Wenn nicht: notiere** ob LU waehrend des Anrufs weiterspricht, ob LU nach dem Anruf neu gestartet ist, ob der Knopf auf "Stop reading" haengt, ohne dass Ton kommt, und ob "Read aloud" danach noch geht.
- Nach dem Anruf: liest von selbst weiter / steht still, neu startbar / haengt
- [ ] Schritt 16 bestanden

---

## Teil 5: Teilen, Fotos, lokales Netz (Geraet A, rund 4 Minuten)

### Schritt 17: Teilen-Blatt und Speichern in Fotos

Pfad wird nachgetragen. Laut Quelltext: an der Antwort "More", im Blatt "Share". Bild: im Eingabefeld "Attach", Blatt "Add to message", "Photo library". Im Betrachter "Save to Photos".

- **Tu das:** Erstens: Tippe an einer Antwort im Chat auf "More", dann auf "Share". Waehle im Blatt des iPhones "Kopieren". Oeffne die Notizen-App und fuege ein. Zweitens: Zurueck in LU, tippe im Eingabefeld auf "Attach", waehle "Photo library" und dein eigenes Foto. Tippe auf den Anhang, dann im Betrachter auf "Save to Photos". Beim ersten Mal fragt das iPhone nach der Erlaubnis: lies den Text, dann "Erlauben". Oeffne die Fotos-App.
- **Das musst du sehen:** Das Teilen-Blatt des iPhones kommt von unten und zeigt den Anfang des Textes. In den Notizen steht der ganze Text der Antwort. Der Dialog fuer Fotos enthaelt den Satz "LU saves images and videos to your photo library when you choose to save them." und fragt nur nach dem **Hinzufuegen**, nicht nach dem Zugriff auf alle Fotos. In der Fotos-App liegt das Bild als neuestes Bild. LU zeigt kurz "Saved to Photos".
- **Wenn nicht: notiere** ob das Blatt gar nicht kommt, ob der Text abgeschnitten ist, ob der Fotos-Dialog nach dem Zugriff auf die ganze Mediathek fragt, und ob das Bild fehlt, obwohl LU Erfolg meldet (schwerer Fehler).
- [ ] Schritt 17 bestanden

### Schritt 18: Lokales Netz fuer Remote

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat, Segment "Remote desktop", "Enter address and passcode", Seite "Connect to desktop" mit den Feldern "Address" und "Passcode" (sechs Ziffern) und dem Knopf "Connect".

- **Tu das:** Nur im offenen Paket, im App-Store-Paket gibt es Remote nicht. LU am Computer laeuft, Remote Access ist dort an, beide Geraete sind im selben WLAN. In LU am iPhone: Reiter Chat, "Remote desktop", "Enter address and passcode". Tippe Adresse und Passcode vom Computer ab, dann "Connect". Das iPhone fragt, ob LU Geraete im lokalen Netzwerk finden darf: lies den Text, dann "Erlauben". Sende im Remote-Chat: `Say hello in five words.`
- **Das musst du sehen:** Der Dialog des iPhones erscheint genau einmal und enthaelt den Satz "LU connects to LU on your own computer over your local network when you set up Remote." Danach steht "Connected to" mit dem Namen des Computers (bei einem aelteren Desktop-LU mit seiner Adresse). Waehrend der Computer rechnet, steht "Your desktop is working on it". Die Antwort erscheint am iPhone am Stueck, nicht Wort fuer Wort, und zugleich im LU am Computer.
- **Wenn nicht: notiere** ob der Dialog kam. Kam er nicht und die Verbindung scheitert mit "Could not reach your desktop", sieh nach unter Einstellungen, Datenschutz und Sicherheit, Lokales Netzwerk, ob LU dort steht und eingeschaltet ist, und notiere das. Notiere auch die Fehlermeldung in LU im Wortlaut.
- Zusatz, falls Zeit ist: Schalte LU unter Einstellungen, Datenschutz und Sicherheit, Lokales Netzwerk aus und versuche erneut zu verbinden. Erwartet ist "Could not reach your desktop" und in der Pruefung der Verbindung der Satz "LU may find devices on your network: in the settings of this phone, open LU and turn on Local Network.", kein endloses Laden. Schalte danach wieder ein. Ergebnis: ____________________
- [ ] Schritt 18 bestanden

---

## Teil 6: Darstellung (Geraet A, rund 4 Minuten)

Stelle sicher, dass die Ausrichtungssperre aus ist (Kontrollzentrum, Schloss mit Pfeil nicht rot).

### Schritt 19: Tastatur und Raender mit Dynamic Island, hoch und quer

**Gestrichen am 10.10.2026:** im Simulator belegt (`ABNAHME.md` Zeile 5.3 und 5.4). Nur noch machen, wenn Zeit bleibt. Die Nummer bleibt, damit die Verweise stimmen.

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat, eine Unterhaltung mit mehreren Nachrichten.

- **Tu das:** Oeffne eine Unterhaltung im Hochformat. Tippe in das Eingabefeld. Tippe drei Zeilen Text mit Zeilenumbruechen. Schliesse die Tastatur. Drehe das iPhone ins Querformat, einmal mit der Dynamic Island nach links, einmal nach rechts. Tippe wieder in das Eingabefeld. Geh zurueck zur Chat-Liste und sieh dir die Leiste mit Chat, Create, Models, Settings an. Drehe zurueck ins Hochformat.
- **Das musst du sehen:** Im Hochformat: Das Eingabefeld sitzt direkt ueber der Tastatur und ist ganz sichtbar, auch die Knoepfe darin. Es waechst mit den drei Zeilen. Die letzte Nachricht bleibt sichtbar. Kein Text und kein Knopf liegt unter der Dynamic Island, unter der Uhrzeit oder unter dem Strich am unteren Rand. Im Querformat: Die Leiste steht als Schiene am linken Rand. Nichts liegt unter der Dynamic Island, egal auf welcher Seite sie ist. Mit Tastatur ist das Eingabefeld sichtbar und mindestens eine Zeile des Verlaufs. Nach dem Zurueckdrehen sieht alles aus wie vorher, der getippte Text ist noch da.
- **Wenn nicht: notiere** mit Bildschirmfoto, was verdeckt oder abgeschnitten ist, in welcher Ausrichtung, und ob die Tastatur offen war. Notiere auch weisse oder schwarze Balken an den Raendern.
- [ ] Schritt 19 bestanden

### Schritt 20: Grosse Systemschrift

**Gestrichen am 10.10.2026:** im Simulator belegt (`ABNAHME.md` Zeile 5.8). Nur noch machen, wenn Zeit bleibt. Die Nummer bleibt, damit die Verweise stimmen.

Pfad wird nachgetragen. Laut Quelltext: alle vier Reiter, dazu das Blatt "Add to message" (im Chat "Attach") und in "Diagnostics" die Zeile "Text size".

- **Tu das:** iPhone-Einstellungen, Anzeige und Helligkeit, Textgroesse: Regler ganz nach rechts. Dann Einstellungen, Bedienungshilfen, Anzeige und Textgroesse, Groesserer Text: einschalten und den Regler auf die dritte Stufe von rechts. Oeffne LU. Sieh dir an: die Chat-Liste, eine Unterhaltung mit Eingabefeld, das Blatt "Add to message", Models mit einem Modell, Settings, und in "Diagnostics" die Zeile "Text size".
- **Das musst du sehen:** Die Schrift in LU ist deutlich groesser als vorher. Bei "Text size" steht "the phone asks for" mit einem Wert ueber 100 Prozent. Kein Text ist abgeschnitten oder liegt ueber anderem Text. Knoepfe sind vollstaendig lesbar oder brechen in zwei Zeilen um. Listen und Blaetter lassen sich rollen, bis alles erreichbar ist. Die untere Leiste bleibt benutzbar.
- **Wenn nicht: notiere** mit Bildschirmfoto jede Stelle, an der Text abgeschnitten ist, sich ueberlappt oder ein Knopf nicht mehr erreichbar ist. Bleibt die Schrift in LU so klein wie vorher, notiere "Schrift folgt dem System nicht" und den Wert bei "Text size".
- **Danach:** Stelle die Textgroesse wieder auf den alten Wert.
- [ ] Schritt 20 bestanden

---

## Teil 7: Das zweite Geraet (Geraet B, rund 10 Minuten)

Installiere LU frisch auf Geraet B und geh durch die Einrichtung wie in Schritt 1. Nimm das kleinste Modell, das LU vorschlaegt.

### Schritt 21: Tastatur und Raender mit Home-Knopf, hoch und quer

Pfad wird nachgetragen. Laut Quelltext: wie Schritt 19.

- **Tu das:** Dasselbe wie Schritt 19 auf Geraet B.
- **Das musst du sehen:** Dasselbe wie in Schritt 19. Zusaetzlich, weil der Bildschirm klein ist: Bei offener Tastatur im Hochformat sind noch mindestens zwei Zeilen des Verlaufs zu sehen. Die Leiste unten hat keinen leeren Streifen darunter. Oben liegt nichts unter der Statusleiste mit Uhrzeit und Akku. Alle vier Namen der Leiste sind lesbar. Eine kurze Meldung am unteren Rand (zum Beispiel nach "Copy") verdeckt das Eingabefeld nicht.
- **Wenn nicht: notiere** mit Bildschirmfoto wie in Schritt 19. Notiere eigens, wenn im Querformat mit Tastatur das Eingabefeld nicht mehr zu sehen ist.
- [ ] Schritt 21 bestanden

### Schritt 22: Aelterer Chip (A12 oder A13): Rueckfall auf den Prozessor ist sichtbar

Nur mit einem iPhone XR, XS, 11, 11 Pro oder SE der 2. Generation. Hast du keines, schreibe "kein Geraet mit A12 oder A13" und lass den Schritt offen. Pfad wird nachgetragen. Laut Quelltext: Settings, "On device engine", Zeile "Runs on", und "Troubleshooting", "Run engine self test".

- **Tu das:** Schreibe im Chat: `Count from 1 to 20, then write three sentences about the sea.` Lies die Antwort. Oeffne Settings, "On device engine" und danach "Troubleshooting", "Diagnostics". Tippe auf "Run engine self test".
- **Das musst du sehen:** Die Antwort ist in jedem Fall lesbarer Text mit den Zahlen 1 bis 20. Dazu einer von zwei Zustaenden, und die App sagt klar welcher. Entweder: Bei "Runs on" steht "Graphics acceleration" (die **GPU**), der Selbsttest meldet "Passed with graphics acceleration, N tokens per second." Oder: Bei "Runs on" steht "Processor" (die **CPU**), im Chat und in "On device engine" steht der Hinweis "Graphics acceleration is not available. LU is running on the processor, which is slower.", bei "Accelerator" steht "Processor, graphics acceleration failed the self test", und der Selbsttest meldet "Passed on the processor after graphics acceleration failed, N tokens per second."
- **Wenn nicht: notiere** jeden anderen Ausgang als schweren Fehler mit Bildschirmfoto: Unsinn als Antwort (zum Beispiel lauter gleiche Zeichen), Prozessor ohne den Hinweis, ein Absturz beim Laden, oder ein Modell, das gar nicht startet.
- Ausgang: GPU / CPU mit Hinweis / anderes: ____________________ Tokens pro Sekunde: ________
- [ ] Schritt 22 bestanden

---

## Teil 8: Der Langlaeufer (Geraet A, 1 Minute Arbeit, 1 Stunde Warten)

### Schritt 23: Eine Stunde im Hintergrund

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat. Wo genau der Hinweis nach einem Neustart steht, ist am Geraet nicht nachgesehen.

- **Tu das:** Schalte Cloud aus, das mittlere lokale Modell ist gewaehlt. Tippe zuerst in einem zweiten Chat einen Satz in das Eingabefeld, ohne ihn zu senden. Schreibe dann im ersten Chat: `Write 800 words about the history of clocks.` Sobald die ersten Zeilen erscheinen, wechsle zum Home-Bildschirm. Sperre das iPhone und lass es eine Stunde liegen. Du darfst es in der Zeit normal benutzen, nur LU nicht oeffnen. Nach einer Stunde: Oeffne LU.
- **Das musst du sehen:** Einen von zwei guten Ausgaengen. Entweder: LU ist noch da wie verlassen, die Teilantwort steht da, und LU schreibt weiter oder bietet unter der Antwort einen Knopf zum Weitermachen an (wie in Schritt 8). Oder: LU startet neu (Startbild zu sehen), zeigt den Hinweis "LU was closed while answering" mit "Continue answer", "Open chat" und "Dismiss", und nach "Open chat" steht die Teilantwort da. In beiden Faellen steht der nicht gesendete Satz im zweiten Chat noch im Eingabefeld, und eine neue Frage wird beantwortet.
- **Wenn nicht: notiere** ob die Teilantwort fehlt, ob der nicht gesendete Satz fehlt, ob LU nach der Rueckkehr nicht mehr antwortet (dann: wie lange gewartet, was hilft: Modell neu waehlen, App neu starten), und welche Meldung erscheint.
- Ausgang: App lebte noch / Neustart mit Hinweis / Neustart ohne Hinweis / haengt
- [ ] Schritt 23 bestanden

---

## Teil 9: Was nur das Geraet zeigt (Geraet A, rund 15 Minuten plus ein grosser Download)

Diese Schritte stammen aus `mobile-docs/NATIVE-SCHICHT.md`, Abschnitt 9, und aus `mobile-docs/KATALOG-PROBE.md`. Im Simulator sind sie nicht pruefbar oder dort nur gegen ein Testbett gelaufen.

### Schritt 24: Speicher beim Laden eines Modells

Pfad wird nachgetragen. Laut Quelltext: Settings, "On device engine", "Unload model". "Troubleshooting", "Diagnostics", "Refresh". Den Speicherabdruck selbst (`phys_footprint`) zeigt die App nicht. Die Zeile "Memory available to LU" ist der Ersatz: sie faellt um das, was LU neu belegt.

- **Tu das:** Waehle das mittlere Modell aus Schritt 3. Oeffne Settings, "On device engine" und tippe auf "Unload model". Oeffne "Troubleshooting", "Diagnostics", tippe auf "Refresh" und notiere "Memory available to LU". Geh in den Chat, sende `Say hello.` und warte auf die Antwort. Geh zurueck zu "Diagnostics", tippe auf "Refresh" und notiere den Wert noch einmal. Notiere dazu die Dateigroesse des Modells (Reiter Models, "Installed").
- **Das musst du sehen:** Der zweite Wert ist kleiner als der erste. Der Unterschied liegt in der Groessenordnung der Modelldatei (zwischen der halben und der anderthalbfachen Dateigroesse). "Model loaded" nennt das Modell.
- **Wenn nicht: notiere** beide Werte in jedem Fall. Bleibt der Wert fast gleich, obwohl das Modell antwortet, ist das kein Fehler der App, sondern genau die Auskunft, die fehlt: dann zaehlt das iPhone die Gewichte auf der Grafikkarte nicht zum Abdruck der App, und die Speichergrenzen in `mobile-docs/GERAETE-PASSUNG.md` sind zu vorsichtig. Faellt der Wert um deutlich mehr als die anderthalbfache Dateigroesse, sind sie zu grosszuegig.
- Dateigroesse ________ verfuegbar vor dem Laden ________ nach dem Laden ________
- Hat jemand einen Mac mit Xcode am Kabel: im Speicherbericht von Xcode den Wert der App vor und nach dem Laden ablesen und dazuschreiben: ________ / ________
- [ ] Schritt 24 bestanden

### Schritt 25: Kamera und QR-Code

Pfad wird nachgetragen. Laut Quelltext: Reiter Chat, "Remote desktop", "Scan QR code". Zweiter Weg zur Kamera: im Chat "Attach", "Take photo".

- **Tu das:** Nur im offenen Paket. Trenne zuerst die Verbindung aus Schritt 18, falls sie noch steht. Lass am Computer den QR-Code von Remote Access anzeigen. In LU am iPhone: Reiter Chat, "Remote desktop", "Scan QR code". Beim ersten Mal fragt das iPhone nach der Kamera: lies den Text und tippe auf "Nicht erlauben". Sieh dir an, was LU zeigt. Tippe auf "Open system settings", erlaube dort die Kamera fuer LU, kehre zurueck und tippe noch einmal auf "Scan QR code". Halte die Kamera auf den Code. Tippe danach den Passcode vom Computer ab und dann auf "Connect".
- **Das musst du sehen:** Der Dialog des iPhones enthaelt den Satz "LU uses the camera when you choose to take a photo for a chat or an image request, and to scan the QR code that pairs this phone with LU on your computer." Nach dem Ablehnen steht in LU "LU needs the camera to scan the code." mit dem Knopf "Open system settings", und der Knopf oeffnet die Seite von LU in den iPhone-Einstellungen. Nach dem Erlauben zeigt LU das Kamerabild mit dem Satz "Point the camera at the QR code on your desktop." Der Code wird binnen weniger Sekunden erkannt. Danach steht die Adresse des Computers im Feld "Address", verbunden ist noch nichts. Nach dem Passcode und "Connect" steht "Connected to" mit dem Namen des Computers.
- **Wenn nicht: notiere** ob der Dialog kam, ob nach dem Ablehnen ein leerer oder schwarzer Bildschirm bleibt, ob "Open system settings" etwas oeffnet, und ob der Code erkannt wird (Abstand, Licht). Notiere auch, ob LU nach dem Scannen ohne dein Zutun verbunden war: das waere seit Runde 3 ein Fehler.
- **Dazu:** Geh nach dem Verbinden noch einmal auf die Seite zum Scannen und tippe auf "Scan again": das Kamerabild kommt wieder. Im Simulator gab es keine Kamera, der Knopf ist dort nie gelaufen.
- [ ] Schritt 25 bestanden

### Schritt 26: Haptik

Pfad wird nachgetragen. Laut Quelltext gibt LU einen leichten Impuls an Schaltern, an Listenzeilen und an den Knoepfen im Eingabefeld, und einen deutlicheren beim Einschalten von Cloud und bei einem fertigen Download.

- **Tu das:** iPhone-Einstellungen, Toene und Haptik: "Systemhaptik" ist an. Halte das iPhone ohne Huelle in der Hand. Erstens: Settings, "Voice", lege den Schalter "Read aloud" zweimal um. Zweitens: tippe in Settings auf eine Zeile, zum Beispiel "Appearance". Drittens: sende im Chat eine kurze Nachricht. Viertens: schalte Cloud aus und wieder ein ("Switch to Cloud"). Fuenftens: achte beim naechsten fertigen Download (Schritt 27) auf den Moment, in dem "Installed" erscheint.
- **Das musst du sehen:** Bei den ersten drei Dingen spuerst du je einen kurzen, leichten Impuls. Beim Einschalten von Cloud und beim fertigen Download spuerst du einen deutlicheren, zweiteiligen Impuls. Nichts brummt lange oder mehrfach.
- **Wenn nicht: notiere** je Stelle: gespuert / nicht gespuert / zu stark. Spuerst du nirgends etwas, pruefe "Systemhaptik" und notiere "keine Haptik".
- Schalter ____ Zeile ____ Senden ____ Cloud ein ____ Download fertig ____
- [ ] Schritt 26 bestanden

### Schritt 27: Grosser Download ueber Mobilfunk und beim Wechsel des Netzes

Pfad wird nachgetragen. Laut Quelltext: Settings, "Storage and downloads", Schalter "Download on Wi-Fi only" ("LU asks before it downloads a model on mobile data."). Reiter Models, "Downloads". Einen Schalter fuer die Geschwindigkeit hat die Seite auf dem iPhone nicht.

- **Tu das:** Erstens: Schalte "Download on Wi-Fi only" ein. Schalte am iPhone das WLAN aus, sodass nur Mobilfunk bleibt. Starte im Reiter Models den Download eines Modells mit 3 GB oder mehr. Sieh nach, was LU fragt, und tippe auf "Wait for Wi-Fi". Zweitens: Schalte das WLAN wieder ein und starte den Download, falls er nicht von selbst beginnt. Bei rund 20 Prozent: Sperre das iPhone und lass es liegen, bis der Download fertig sein muesste (rechne mit der Geschwindigkeit, die die Zeile anzeigt). Drittens, falls du ein zweites WLAN hast: starte einen weiteren Download und wechsle bei rund 30 Prozent in den iPhone-Einstellungen vom ersten in das zweite WLAN.
- **Das musst du sehen:** Erstens: LU fragt "Download on mobile data?" mit dem Satz "You are not on Wi-Fi. This download is ... and may use your data plan." und nennt die Groesse. Nach "Wait for Wi-Fi" laedt nichts ueber Mobilfunk. Zweitens: nach dem Entsperren ist der Download fertig ("Installed") oder deutlich weiter, nie zurueck auf 0. Das Modell laesst sich laden und antwortet. Drittens: nach dem Wechsel des WLANs laeuft der Download von selbst oder nach "Resume" an der alten Stelle weiter.
- **Wenn nicht: notiere** ob die Frage fehlte, ob ueber Mobilfunk trotzdem geladen wurde, auch nach "Resume" oder einem neuen Versuch (seit Runde 3 gilt die Regel bei jedem Start und Fortsetzen, am iPhone hat das niemand gesehen), Prozent vor und nach dem Sperren, die Dauer, und den Text der Zeile.
- Mobilfunk: Frage kam, nichts geladen / keine Frage / hat geladen. Gesperrt: von ____ % auf ____ % in ____ Minuten. Netzwechsel: weiter / neu bei 0 / haengt
- [ ] Schritt 27 bestanden

### Schritt 28: Anmeldung nach einem Update und nach dem Loeschen der App

Pfad wird nachgetragen. Laut Quelltext liegt die Sitzung im Schluesselbund des iPhones. Belegt ist das Verhalten nur im Simulator gegen ein Testbett.

- **Tu das:** Du bist angemeldet (Schritt 12). Erstens, nur wenn es in TestFlight eine neuere Baunummer gibt: aktualisiere LU dort, oeffne LU und sieh in Settings auf die Karte oben. Zweitens, ganz am Ende der Liste, weil dabei Chats und Modelle verloren gehen: loesche LU (lange auf das Symbol druecken, "App entfernen", "App loeschen"), installiere neu, geh durch die Einrichtung und sieh in Settings auf die Karte oben.
- **Das musst du sehen:** Erstens: nach dem Update bist du weiter angemeldet, Chats und Modelle sind da. Zweitens: nach dem Loeschen und der Neuinstallation sind Chats und Modelle weg, das ist richtig so. Fuer die Anmeldung gibt es zwei moegliche Ausgaenge, und wir muessen wissen, welcher eintritt: du bist abgemeldet, oder du bist ohne dein Zutun wieder angemeldet (der Schluesselbund von iOS kann das Loeschen einer App ueberleben).
- **Wenn nicht: notiere** ob du nach dem Update abgemeldet bist oder Chats fehlen (schwerer Fehler), und welcher der beiden Ausgaenge nach der Neuinstallation eintrat.
- Nach dem Update: angemeldet / abgemeldet / nicht geprueft. Nach der Neuinstallation: angemeldet / abgemeldet
- **Nur im App-Store-Paket:** Die Antwort auf die Altersfrage liegt ebenfalls im Schluesselbund. Notiere, ob die Frage nach der Neuinstallation wieder kommt: kam wieder / kam nicht. Bestaetige "Yes, I am under 18" auf keinem iPhone, das du weiter benutzen willst (`DAVID-GERAETETEST.md`, B14).
- [ ] Schritt 28 bestanden

### Schritt 29: Wegwischen direkt nach einer Aenderung

Pfad wird nachgetragen. Laut Quelltext: LU sichert beim Verlassen und beim Beenden (`app-will-terminate`). Im Simulator ging ein Wert, der unmittelbar vor einem Neustart des Geraets geschrieben wurde, einmal verloren.

- **Tu das:** Oeffne Settings, "Appearance" und stelle das Aussehen um (hell auf dunkel oder umgekehrt). Geh sofort in einen Chat und tippe einen Satz in das Eingabefeld, ohne zu senden. Oeffne **innerhalb von zwei Sekunden** den App-Umschalter und wische LU nach oben weg. Oeffne LU wieder. Wiederhole das Ganze einmal, schalte dabei aber statt des Wegwischens das iPhone aus (Seitentaste und Lauter halten, ausschalten) und wieder ein.
- **Das musst du sehen:** Beide Male: Das Aussehen ist so, wie du es zuletzt gestellt hast. Der nicht gesendete Satz steht im Eingabefeld des Chats.
- **Wenn nicht: notiere** was fehlt (Aussehen, Satz, beides) und bei welchem der beiden Durchgaenge (Wegwischen oder Ausschalten).
- Wegwischen: beides da / fehlt: ________ Ausschalten: beides da / fehlt: ________
- **Dritter Durchgang, neu am 10.10.:** Oeffne einen neuen Chat, sende `Write a long story about a sailor.` und wische LU **ein bis zwei Sekunden nach dem Tipp auf Senden** weg. Oeffne LU. Der neue Chat steht in der Liste, mit deiner Frage und dem Hinweis "LU was closed while answering". Mach das dreimal.
- Neuer Chat nach dem Wegwischen: dreimal da / fehlte ____ mal
- [ ] Schritt 29 bestanden

### Schritt 30: Teilen mit echten Zielen

Pfad wird nachgetragen. Laut Quelltext: im Chat oben "Chat menu", "Export". In Settings, "Troubleshooting", "Share log" und "Share report".

- **Tu das:** Erstens: Oeffne einen Chat mit mehreren Nachrichten, tippe oben auf "Chat menu", dann "Export" und waehle Markdown. Waehle im Teilen-Blatt "In Dateien sichern", lege die Datei unter "Auf meinem iPhone" ab und oeffne sie in der Dateien-App. Zweitens: Exportiere noch einmal und waehle AirDrop zu einem Mac oder einem zweiten iPhone, oder die Nachrichten-App an dich selbst. Drittens: Settings, "Troubleshooting", "Share report", waehle "Kopieren" und fuege in den Notizen ein.
- **Das musst du sehen:** Jedes Mal kommt das Teilen-Blatt des iPhones mit einem Dateinamen oder dem Anfang des Textes. Die Datei in der Dateien-App laesst sich oeffnen und enthaelt den ganzen Chat. Beim Empfaenger kommt dieselbe Datei an. Der Bericht in den Notizen nennt Geraet, Version, Speicher und "Accelerator" und enthaelt keine Inhalte aus deinen Chats.
- **Wenn nicht: notiere** bei welchem Ziel es scheitert, ob die Datei leer oder abgeschnitten ist, und ob LU nach dem Schliessen des Blatts haengt.
- [ ] Schritt 30 bestanden

---

## Teil 10: Am Mac (Geraet A am Kabel, rund 5 Minuten)

### Schritt 31: Die Oberflaeche ist von aussen nicht einsehbar

Pfad wird nachgetragen. Belegt ist bisher nur am Paket, dass der gewoehnliche Bau die Einsicht nicht freigibt (`mobile-docs/BAUEN.md`, Abschnitt 4.7). Dieser Schritt gilt fuer den Bau aus TestFlight oder den gewoehnlichen Release, nicht fuer einen Abnahmebau.

- **Tu das:** Am iPhone: Einstellungen, Apps, Safari, Erweitert, "Web-Inspektor" einschalten. Am Mac: Safari, Einstellungen, Erweitert, "Funktionen fuer Web-Entwickler anzeigen" einschalten. Schliesse das iPhone per Kabel an und bestaetige "Vertrauen". Oeffne LU am iPhone und lass es im Vordergrund. Oeffne am Mac in Safari das Menue "Entwickler" und dort den Eintrag mit dem Namen deines iPhones. Oeffne zur Gegenprobe am iPhone Safari mit einer beliebigen Seite und sieh noch einmal in das Menue.
- **Das musst du sehen:** Unter dem Namen des iPhones steht LU **nicht**. Dort steht "Keine untersuchbaren Programme" oder nur Safari. In der Gegenprobe erscheint die Seite aus Safari im Menue: damit weisst du, dass der Weg an sich geht.
- **Wenn nicht: notiere** ob LU im Menue erscheint und ob sich ein Fenster mit dem Inhalt der App oeffnen laesst. Das ist ein schwerer Befund: Bildschirmfoto vom Mac, dazu die Version und Baunummer von LU und der Weg der Installation. Erscheint auch in der Gegenprobe nichts, notiere "Gegenprobe ohne Ergebnis", dann sagt der Schritt nichts aus.
- [ ] Schritt 31 bestanden

---

## Teil 11: Nachtraege vom 10.10. (Geraet A, rund 5 Minuten)

Zwei Dinge, die die Simulator-Berichte als nicht pruefbar nennen. Sie gehoeren inhaltlich zu Teil 9.

### Schritt 32: Groesse des iCloud-Backups

Pfad wird nachgetragen. Laut Quelltext tragen Modelldateien das Kennzeichen, das sie vom Backup ausnimmt. Im Simulator ist nur das Kennzeichen an der Datei gesehen, nicht das Backup selbst.

- **Tu das:** Mindestens ein Modell ist geladen, am besten auch eines ueber "Import a model file" eingebracht. iPhone-Einstellungen, dein Name, iCloud, Speicher (oder "Accountspeicher verwalten"), Backups, dieses iPhone. Warte, bis die Liste der Apps geladen ist, und lies die Zeile LU. Vergleiche mit Settings, "Storage and downloads" in LU.
- **Das musst du sehen:** Die Groesse bei LU im Backup liegt in der Naehe von "Chats and files", nicht in der Naehe von "Model storage". Modelle von mehreren GB stehen nicht im Backup.
- **Wenn nicht: notiere** beide Zahlen. Steht LU mit mehreren GB im Backup, ist das ein Fehler: jedes Modell wuerde in die iCloud geladen.
- Backup laut iPhone ________ "Chats and files" laut LU ________ "Model storage" laut LU ________
- [ ] Schritt 32 bestanden

### Schritt 33: Eine Webseite ueber Mobilfunk lesen

Pfad wird nachgetragen. Viele Mobilfunknetze geben dem iPhone nur eine IPv6-Adresse. Diesen Weg konnte kein Simulator nachstellen.

- **Tu das:** WLAN aus, nur Mobilfunk. Waehle ein Modell mit der Marke "Tools" und schalte in den Chat-Optionen "Agent mode" ein. Sende `Read this page and tell me the latest version: https://www.python.org`. Schalte danach das WLAN wieder ein.
- **Das musst du sehen:** Die Zeile "Read a page" laeuft und endet ohne "failed". Die Antwort nennt eine Versionsnummer.
- **Wenn nicht: notiere** den Text der Zeile und der Antwort und den Namen deines Mobilfunkanbieters. Passt auf deinem iPhone kein Modell mit der Marke "Tools", notiere das: dann ist Agent mode dort nicht benutzbar, und auch das wollen wir wissen.
- [ ] Schritt 33 bestanden

---

### Schritt 34: Sign in with Apple

Neu seit Runde 15, an keinem Geraet gelaufen. Braucht ein signiertes Paket mit der Kennung `com.purpledoubled.lu` und die Einstellungen bei Apple und Supabase (`mobile-docs/RELEASE-KNOPF.md`, Abschnitt 1, Punkte 2 und 3). Im Simulator und im unsignierten Paket antwortet das System mit einem Fehler, das ist dort richtig.

- **Tu das:** Melde dich in LU ab. Settings, "Sign in to LU Cloud". Sieh dir die Knoepfe an, einmal im hellen und einmal im dunklen Design (Settings, Appearance). Tippe "Sign in with Apple". Im Blatt des iPhones waehle beim ersten Mal "Share My Email" und bestaetige mit Face ID oder Code.
- **Das musst du sehen:** "Sign in with Apple" steht ueber "Continue with Google" und "Continue with GitHub", gleich breit und gleich hoch, mit dem Apple-Zeichen vor dem Text: im dunklen Design weiss mit schwarzer Schrift, im hellen schwarz mit weisser Schrift. Unter den drei Knoepfen steht "Use the same sign-in you used before to reach your existing account." Nach dem Tippen kommt das Blatt des iPhones von unten, kein Browser. Nach der Bestaetigung zeigt die Seite "Account" deine Adresse, den Tarif und "Sign out".
- **Dann:** Melde dich ab und tippe noch einmal "Sign in with Apple", diesmal schliesst du das Blatt mit dem Kreuz. LU zeigt danach nichts: keine Meldung, kein Fehler, die Seite wie vorher. Danach ein drittes Mal und bestaetigen: du bist wieder im selben Konto wie beim ersten Mal (dieselbe Adresse).
- **Wenn Zeit ist, zwei Fragen an das Konto** (das beantwortet, was `r15/apple-anmeldung.md` offen laesst): 1. Hat dein Apple-Konto dieselbe E-Mail-Adresse wie ein LU-Konto, das mit Google angelegt wurde: landest du mit "Share My Email" in diesem Konto (Tarif und Guthaben sind da) oder in einem neuen, leeren? 2. Mit einem zweiten Apple-Konto und "Hide My Email": die Seite zeigt eine Adresse, die auf `privaterelay.appleid.com` endet, und das Konto ist neu und leer. Das ist erwartet.
- **Wenn nicht: notiere** den Satz, den LU zeigt, woertlich. "Sign in with Apple is not available right now. ..." heisst: das iPhone ist an keinem Apple-Konto angemeldet, oder dem Paket fehlt die Faehigkeit im Profil. "Sign in with Apple did not work. Try again, or sign in another way." heisst: das Blatt war in Ordnung, aber der Kontoserver hat abgelehnt, dann fehlt der Anbieter Apple im Supabase-Projekt oder die Client-ID dort ist nicht `com.purpledoubled.lu`. Zeigt der Knopf statt des Apple-Zeichens ein leeres Kaestchen: Bildschirmfoto.
- [ ] Schritt 34 bestanden

## Bericht

Schicke diese Angaben an David zurueck. Am einfachsten: diese Datei ausgefuellt, dazu die Bildschirmfotos.

1. **Kopf:** Geraet A und Geraet B mit Modell und iOS-Version, Version von LU, Weg der Installation (TestFlight oder Xcode), Datum und Uhrzeit.
2. **Diagnosebericht je Geraet:** In Settings, "Troubleshooting", "Diagnostics" auf "Copy report" tippen (LU zeigt "Report copied") und den Text einfuegen, einmal direkt nach Schritt 2 und einmal direkt nach Schritt 6.
3. **Tabelle der Geschwindigkeiten** aus Schritt 3, dazu der Wert nach dem Dauerlauf aus Schritt 6 und der Wert von Geraet B aus Schritt 22.
4. **Liste der Schritte:** je Schritt "bestanden" oder "nicht bestanden". Fuer jeden nicht bestandenen Schritt die verlangte Notiz und das Bildschirmfoto.
5. **Die ausgewaehlten Ausgaenge** aus den Schritten 7, 15, 16, 22, 23, 27, 28 und 29 (dort gibt es mehrere gute Ausgaenge, und wir muessen wissen, welcher eintrat).
6. **Zahlen:** Akku vorher und nachher aus Schritt 6, Sekunden aus Schritt 9, Prozentzahlen aus Schritt 10 und 27, die beiden Speicherwerte aus Schritt 24, die drei Zahlen aus Schritt 32.
7. **Jeder Weg, der nicht stimmte:** ein Reiter, eine Zeile oder ein Knopf, der anders heisst oder woanders liegt als hier beschrieben. Damit verschwindet der Vermerk "Pfad wird nachgetragen".
8. **Alles Unerwartete,** das in keinem Schritt vorkommt: Abstuerze, haengende Bildschirme, falsche Texte, Stellen, an denen du nicht wusstest, was zu tun ist. Mit Uhrzeit, damit sich der Absturzbericht finden laesst.
9. **Absturzberichte,** falls LU abgestuerzt ist: iPhone-Einstellungen, Datenschutz und Sicherheit, Analyse und Verbesserungen, Analysedaten. Eintraege, die mit "LU" beginnen, antippen, oben rechts teilen. Eintraege mit "JetsamEvent" im Namen vom selben Zeitpunkt ebenfalls: sie belegen, dass das System die App wegen Speicher beendet hat.
10. **Dein Eindruck in zwei Saetzen:** Fuehlt sich die App auf dem iPhone schnell genug an, um sie zu benutzen? Was hat am meisten gestoert?

Schritte, die du nicht ausfuehren konntest (fehlendes Geraet, fehlender Computer, fehlende SIM, kein zweiter Bau in TestFlight), bleiben offen. Schreibe den Grund dazu. Offen ist nicht dasselbe wie nicht bestanden.
