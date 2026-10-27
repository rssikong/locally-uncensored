# Persona-Drehbuch: der ganze Kundenfluss

Fuer den Persona-Agenten, der Punkt 3 aus `MOBILE-ZIEL.md` belegt. Das Skript `flows/kundenfluss.mjs` spielt dieselben Schritte mit echten Touches und legt je Schritt einen Screenshot ab. Die Schritt-Kennungen hier und dort sind dieselben.

**Ein gruener Lauf ist kein Beleg.** Das Skript misst, ob etwas erschienen ist. Ob es das Richtige ist, entscheidet, wer die Screenshots ansieht. Zu jedem Schritt steht unten, worauf die Persona achtet.

## Wer die Persona ist

Mara, 34, hat LU auf einer Webseite gesehen und die App gerade installiert. Sie kennt weder den Desktop noch das Wort "GGUF". Sie hat ein Handy mit 8 GB und WLAN. Sie tippt mit dem Daumen, liest keine Anleitung und gibt nach zwei unklaren Schirmen auf. Was sie nicht versteht, zaehlt als Befund, auch wenn es funktioniert.

## Regeln fuer den Lauf

- Frisches Geraet: `FRISCH=1` loescht die App-Daten. Nur auf einem Emulator oder Simulator, der diesem Lauf allein gehoert.
- Kein Agent tippt ein Passwort, schickt eine Anmeldung ab, loescht ein Konto, sendet eine Meldung oder schickt eine Kopplung ab. Das Skript kann es nicht: `f.tippe` lehnt Passwortfelder ab, die Knoepfe stehen auf der Sperrliste.
- Cloud kostet Geld. Je volle Runde (ein `LAUF_DIR`) hoechstens 1 Bild mit flux-schnell, 1 Diktat, 1 Vorlesen und 2 Cloud-Nachrichten mit dem guenstigsten Modell (eine hier, eine im Fehlerfall "Netz bricht im Stream"). Nur mit `ALLOW_PAID=1` und nur, wenn das Geraet schon angemeldet ist. Der Zaehler steht in `<lauf>/kosten.json`.
- Ist niemand angemeldet, enden die Cloud-Schritte mit "nicht pruefbar ohne Anmeldung". Das ist kein Fehler und kein Beleg.
- Jeder gesperrte Knopf, den das Skript trotzdem tippt, steht mit Begruendung im Ergebnis (`freigaben` je Schritt).

## Die Schritte

| Nr | Kennung | Was Mara tut | Was sie sehen muss | Worauf die Persona am Screenshot achtet |
|---|---|---|---|---|
| 1 | `frisch` | oeffnet die App zum ersten Mal | Altersabfrage oder Willkommen | Kein leerer Schirm, kein Desktop-Fenster, Statusleiste frei |
| 2 | `altersabfrage` | antwortet "Yes, I am 18 or older", falls gefragt | Preset `open`: keine Frage. `play` und `appstore`: Frage, danach Willkommen | Frage ist verstaendlich, beide Knoepfe gleich gut treffbar. Die Antwort Nein spielt `flows/alter.mjs` |
| 3 | `onboarding-willkommen` | tippt "Get started" | Seite mit Startmodellen | Sagt die Seite in einem Satz, was LU ist? Ist "I have an account" zu sehen, ohne zu draengen? |
| 4 | `startmodell-laden` | waehlt das kleinste Modell, tippt Download, wartet | Fortschritt, dann "ready" | Groesse und Passt-Urteil stehen an der Karte. Fortschritt zeigt Menge und Rest. Pause und Abbrechen sind da. Die App empfiehlt ein groesseres Modell: Der Lauf weicht bewusst ab, das Urteil ueber die Empfehlung faellt am Bild |
| 5 | `onboarding-dokumente` | liest das Angebot "Document Chat", tippt "Skip" | Abschlussseite | Ist klar, dass man das spaeter nachholen kann und wo? |
| 6 | `onboarding-fertig` | tippt "Start chatting" | leerer Chat mit dem geladenen Modell | Modellname steht im Chat. Kein Hinweis "kein Modell" |
| 7 | `erster-chat` | schreibt "Say hello in five words." und sendet | Antwort streamt und wird fertig | Tastatur verdeckt das Feld nicht. Stopp-Knopf waehrend der Antwort. Antwort ist lesbar, Aktionen darunter |
| 8 | `anhang` | tippt die Bueroklammer, "Choose file", waehlt `lu-test-<lauf>-anhang.txt` (Inhalt von `lu-test.txt`, je Lauf ein neuer Name), fragt nach dem Geheimwort | Dateiauswahl des Systems, Chip am Entwurf, Antwort | Kommt wirklich die Auswahl des Systems? Steht der Dateiname am Chip? Die Antwort nennt HARLEKIN (bei 360 Mio. Parametern nicht sicher, das Skript notiert es nur) |
| 9 | `chat-optionen` | oeffnet die Optionen, sieht sich "Sampling" an, geht zurueck, tippt "Done" | Blatt mit Abschnitten, Unterseite, Blatt schliesst | Blatt laesst sich mit einer Hand bedienen. Zurueck im Blatt fuehrt eine Ebene hoch, nicht aus dem Chat |
| 10 | `persona` | waehlt in den Optionen die Persona "Coder", fragt "Who are you?" | Persona gewaehlt, Antwort im Ton der Persona | Sind Personas global aus, sagt die Seite es und bietet den Schalter |
| 11 | `dokument` | Chat-Menue, "Documents", richtet den Dokumenten-Chat ein (rund 80 MB), fuegt `lu-test-<lauf>-dokument.txt` hinzu (je Lauf ein neuer Name, nie ueberschrieben), fragt nach den Oeffnungszeiten. Haelt auf dem Mac ein fremdes Programm Port 8128 (iOS-Simulator), sagt das die Notiz (F-R9) | Dokument in der Liste, Antwort mit "nine to five" | Sagt die Seite vor dem Download, wie gross er ist? Fortschritt beim Einlesen. Bleibt das Dokument auf dem Geraet (Satz dazu)? |
| 12 | `memory` | Einstellungen, "Memory", legt einen Eintrag an | Toast "saved", Eintrag in der Liste | Ist klar, was Memory tut und dass es auf dem Geraet bleibt? |
| 13 | `modellwechsel` | laedt im Reiter Models das zweitkleinste Modell, tippt "Use", chattet, wechselt im Modell-Blatt zurueck | Modell-Chip wechselt zweimal, zwei Antworten | Die Antwort nennt das Modell, das sie geschrieben hat. Der Wechsel verliert den Chat nicht |
| 14 | `agent` | schaltet in den Optionen den Agenten ein, bittet um die Uhrzeit, erlaubt das Werkzeug | Rueckfrage "Allow this step?", Werkzeugzeile, Antwort | Mit den kleinsten Modellen ist der Schalter gesperrt. Dann zaehlt, ob die App sagt warum. Das Skript meldet "nicht pruefbar" und nennt den Satz der App |
| 15 | `einstellungen` | stellt das Design auf hell, dunkel, hell | Die ganze App wechselt die Farben | Kein Rest in der falschen Farbe, auch Statusleiste und Tastatur |
| 16 | `sicherung` | Einstellungen, "Backup and import", "Back up" | Teilen-Blatt des Systems oder Rueckmeldung | Sagt die App, wohin die Sicherung geht und was darin ist? |
| 17 | `konto-maske` | Einstellungen, Konto | angemeldet: Karte, Plan, "Sign out" und "Delete account". Nicht angemeldet: Maske mit E-Mail, Passwort, Google, "Forgot" | Die Maske ist da, kein Feld wird ausgefuellt. Mit einer Hand erreichbar, Tastatur verdeckt den Knopf nicht (ohne zu tippen nur am Layout zu sehen) |
| 18 | `cloud-chat` | waehlt im Modell-Blatt unter "LU Cloud" die guenstigste Zeile, sendet eine Nachricht | Einwilligung beim ersten Mal, Cloud-Chip, Antwort | Preis ist vor dem Senden zu sehen. Die Einwilligung sagt, was das Geraet verlaesst |
| 19 | `bild` | Reiter Create, waehlt flux-schnell, schreibt einen Prompt, tippt den Hauptknopf | Preis am Knopf, Fortschritt, Bild | Das Bild passt zum Prompt. Speichern und Teilen sind da |
| 20 | `sprache-rein` | tippt das Mikrofon, spricht, tippt noch einmal | Aufnahmeanzeige, Text im Feld | Berechtigungsfrage des Systems mit verstaendlichem Text. Im Emulator kommt ohne Ton nur Stille an |
| 21 | `sprache-raus` | tippt "Read aloud" an einer Antwort | Knopf wechselt auf "Stop" | Ton ist zu hoeren (am Geraet, nicht am Bild) |
| 22 | `remote` | Chatliste, "Remote desktop", liest die Hilfe, tippt "Enter code" | Einfuehrung, Hilfeseite, Maske mit Adresse und Code | Bis zur Maske, nichts wird abgeschickt. Versteht Mara, was sie am Desktop tun muss? |
| 23 | `melden` | oeffnet an einer Antwort "More", "Report", waehlt einen Grund | Blatt mit Gruenden, "Send report" wird bedienbar | Bis zum Blatt, nichts wird gesendet. Der Knopf ist ohne Grund gesperrt |
| 24 | `konto-loeschen` | Konto, "Delete account" | Blatt mit Erklaerung und "Delete my account" | Bis VOR die Bestaetigung: "Delete my account" wird nicht getippt, das Skript verlaesst das Blatt mit "Keep my account". Ohne Anmeldung zeigt die Seite den Hinweis und den Weg ueber die Webseite |
| 25 | `abmelden` | "Sign out" | Toast, Maske | Nur mit `ABMELDEN=1`, sonst "uebersprungen": Die Sitzung gehoert David |
| 26 | `beenden-wiederoeffnen` | schiesst die App hart ab und oeffnet sie wieder | Chats, Antworten und das Design sind da, kein Onboarding | Die App kommt dort wieder hoch, wo Mara war, oder auf der Chatliste. Kein Ladeschirm ohne Ende |

## Was das Skript nicht entscheidet

- Ob eine Antwort gut ist. Es prueft, dass eine fertige Antwort da ist, und notiert bei Anhang und Dokument, ob das Stichwort vorkommt.
- Ob ein Text verstaendlich ist. Es prueft, dass Meldungen mehr als ein paar Zeichen haben.
- Ob Ton zu hoeren ist und ob das Mikrofon etwas aufnimmt.
- Ob das billigste Cloud-Modell wirklich das billigste ist. Es nimmt die Zeile, die die App als guenstigste ausweist (`m-chat-model-cloud-cheapest`). Die Gegenprobe gegen die Preisliste macht die Persona einmal am Preis-Blatt.

## Danach

1. `node flows/alter.mjs` mit `FRISCH=1`: die Antwort Nein der Altersabfrage, je Paket ein Preset.
2. `node flows/fehlerfaelle.mjs`: die sieben Fehlerfaelle. Braucht das Modell aus Schritt 4.
3. `node sweep.mjs`: jeder Knopf. Verstellt Schalter, deshalb zuletzt.
4. `node report.mjs $LAUF_DIR`.
