# Flows

Die Ablaeufe aus `MOBILE-ZIEL.md`, Abschnitt 3, mit den echten Kennungen der Mobile-Shell.

| Datei | Abnahmepunkt | Inhalt |
|---|---|---|
| `kundenfluss.mjs` | 3 | 26 Schritte von der frischen Installation bis zum Wiederoeffnen. Dieselben Kennungen wie in `../PERSONA-DREHBUCH.md` |
| `fehlerfaelle.mjs` | 4 | 11 Schritte fuer die 7 Fehlerfaelle, dazu Abschuss mitten im Download und mitten in der Antwort |
| `alter.mjs` | 3 | Altersabfrage je Store-Preset: keine Frage bei `open`, Frage bei `play` und `appstore`, Antwort Nein sperrt, Antwort Ja bleibt ueber einen Neustart |
| `n1.mjs` | 4 | Modelldatei fehlt (N1): Satz mit Namen, kein Pfad. Ist das Ziel geladen, erst ein anderes Modell laden (Pruefung iOS Paket 17, F-R10) |
| `selektoren.mjs` | | Alle Kennungen an einer Stelle, nach Seiten geordnet |
| `freigaben.mjs` | | Welche gesperrten Knoepfe der Sweep trotzdem tippen darf, je mit Begruendung und Grenze |
| `lib.mjs` | | Schrittrahmen, Status, Screenshot je Schritt, Kostenwaechter, Sperrliste |

## Selektoren

`selektoren.mjs` kennt vier Formen:

- `tid('m-...')`: Die Kennung steht in den Quellen der Shell. Fehlt sie am Geraet, ist der Schritt "fehler".
- `offen('m-...')`: Die App hat die Kennung noch nicht. Fehlt sie, ist der Schritt "offen". Stand 08.10.2026 gibt es keinen solchen Eintrag mehr.
- `einer('m-a', 'm-b')`: das erste sichtbare von mehreren (leerer und gefuellter Zustand).
- `innen(aussen, in)`: ein Element in einem anderen, zum Beispiel der Download-Knopf in der Karte eines bestimmten Modells.

`npm run trocken` prueft jede Kennung gegen `../tabelle/tabelle.json` und die Schnappschuesse. Eine Kennung, die es nirgends gibt, ist dort ein Fehler, bevor ein Geraet laeuft.

## Wer tippt

- Im Kundenfluss tippt nur der Treiber, mit echten Touch-Ereignissen: `f.tap`, `f.tippe`, `f.zurueck`, `f.reiter`.
- Der Testhaken (`../lib/haken.mjs`) stellt nur Ausgangslagen her, die kein Finger herstellen kann: Speicher voll, Guthaben leer, Sitzung abgelaufen.
- `f.tippe` lehnt Passwortfelder ab. Kein Fluss fuellt die Anmeldemaske aus oder schickt sie ab.

## Status je Schritt

| Status | Bedeutung |
|---|---|
| ok | gelaufen, Erwartung erfuellt |
| fehler | gelaufen, Erwartung nicht erfuellt |
| offen | ein Testhaken fehlt in der App, oder eine `offen(...)`-Kennung |
| uebersprungen | bezahlter Schritt ohne `ALLOW_PAID=1`, oder ein Mensch muss ran (Abmelden, Sitzung beenden) |
| nicht pruefbar | die Voraussetzung fehlt auf diesem Geraet: keine angemeldete Sitzung, kein Modell mit Werkzeugen, in der Vorschau keine native Seite. Der Grund steht dabei |

Punkt 3 und 4 gelten im Bericht erst als belegt, wenn jeder Schritt "ok" ist. Ein Lauf ohne Anmeldung oder ohne `ALLOW_PAID=1` kann das nie erreichen, ein Lauf in der Vorschau auch nicht.

## Kostenregel

Fest in `../kosten.mjs`, nicht abschaltbar:

- Bezahlte Aufrufe nur mit `ALLOW_PAID=1`.
- Je Lauf hoechstens 1 Bild, 1 STT, 1 TTS. Dazu 2 Cloud-Chats (Kundenfluss und "Netz bricht im Stream"). Das ist ein Zusatz dieses Rahmens, weil Cloud-Chat auch kostet.
- Nur das Modell aus `config.billigsteModelle`. Steht dort nichts, wird der Aufruf verweigert.
- Der Zaehler liegt in `<lauf>/kosten.json`. Mehrere Werkzeuge im selben Lauf (`LAUF_DIR`) teilen ihn sich.
- Ueberschreitung oder falsches Modell bricht den ganzen Lauf ab.

In den Flows gibt es drei Arten zu tippen:

- `f.tap(sel)`: harmlose Elemente. Lehnt alles ab, was auf der Sperrliste steht.
- `f.tapBezahlt(sel, art, {modell, zweck})`: zaehlt erst, tippt dann.
- `f.tapBewusst(sel, grund, {kostenlosWeil})`: gesperrt, aber hier ohne Kosten. Die Begruendung ist Pflicht und steht im Ergebnis des Schritts (`freigaben`). `kostenlosWeil` nennt den Grund in einem Wort: `lokal`, `netz-aus`, `haken`, `schon-gezaehlt`.

Grenze der Regel: Der Rahmen zaehlt nur, was ueber `tapBezahlt` laeuft. Wer mit `d.tap` direkt auf einen Bezahlknopf tippt, umgeht ihn. In Flows deshalb nie `d.tap` auf Bedienelemente der App. Der statische Trockenlauf meldet jeden `f.tap` auf eine gesperrte Kennung.

Die Fehlerfaelle "Guthaben leer" und "Sitzung abgelaufen" senden nichts an die Cloud: Der Haken aendert nur den Zustand in der App, das echte Konto hat weiter Guthaben und ein gueltiges Token. Die Schritte pruefen das Blatt, das die App daraufhin von selbst zeigt.

## Was die Flows nicht tun

- Kein Agent gibt ein Passwort ein. Ist das Geraet nicht angemeldet, enden die Cloud-Schritte mit "nicht pruefbar ohne Anmeldung" und David meldet an.
- Konto loeschen geht bis vor die Bestaetigung, Melden bis vor das Absenden, Remote bis zur Kopplungsmaske, Abmelden nur mit `ABMELDEN=1`.
- Die Flows ersetzen nicht das Hinsehen. Zu jedem Schritt gibt es einen Screenshot, der Persona-Agent schaut jeden an (`../PERSONA-DREHBUCH.md`). Ein gruener Lauf allein ist kein Beleg.

## Aufruf

```
PLATFORM=android LAUF_DIR=out/android/<zeitstempel> FRISCH=1 STORE_PRESET=play node flows/kundenfluss.mjs
PLATFORM=android LAUF_DIR=out/android/<zeitstempel> node flows/fehlerfaelle.mjs
PLATFORM=android LAUF_DIR=out/android/<zeitstempel> node flows/alter.mjs
node report.mjs out/android/<zeitstempel>
```

| Variable | Wirkung |
|---|---|
| `FRISCH=1` | loescht vor dem Kundenfluss die App-Daten. Nur auf einem Geraet, das einem allein gehoert |
| `STORE_PRESET` | `open`, `play` oder `appstore`: welches Preset der Bau traegt. Daran haengt, ob die Altersabfrage kommen muss |
| `AB`, `BIS` | Kundenfluss nur von Schritt bis Schritt (Kennungen aus `SCHRITTE`) |
| `NUR` | Fehlerfaelle: nur diese Schritte, mit Komma getrennt |
| `OHNE_ZWEITES_MODELL=1` | Kundenfluss ohne den zweiten Download |
| `FEHLER_MODELL` | das Modell, an dem die Download-Faelle spielen. Standard `qwen3.5-0.8b` |
| `ALLOW_PAID=1` | erlaubt die bezahlten Schritte, in den Grenzen des Kostenwaechters |
| `ABMELDEN=1`, `SITZUNG_ABLAUFEN=1` | erlaubt die zwei Schritte, nach denen David neu anmelden muss |
| `SPEICHER_ECHT=1` | nur Android: fuellt den Speicher wirklich, statt den Haken zu nehmen |

Ohne Geraet: `PLATFORM=vorschau` spielt dieselben Fluesse gegen die Vite-Vorschau der Shell (`../trocken/`). Das prueft den Rahmen, nicht die App.
