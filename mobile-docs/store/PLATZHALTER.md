# Platzhalter der Store-Unterlagen

Stand 10.10.2026, Adressen nachgezogen am 14.10.2026 (Runde 32: Support-Seite, Loeschseite und Datenschutz der Webseite sind live). Alles, was nur David wissen oder entscheiden kann, steht hier und nur hier. Die Eintraege `PLAY-EINTRAG.md` und `APPSTORE-EINTRAG.md` nennen nur die Kennung in doppelten geschweiften Klammern. Der Waechter `src/mobile/__tests__/store-unterlagen.test.ts` haelt, dass kein Eintrag eine Kennung benutzt, die hier fehlt.

Die Spalte "Vorschlag" nennt nur Werte, die schon oeffentlich im Repo stehen. Sie ist kein Beleg, dass der Wert stimmt: bitte je Zeile bestaetigen oder ersetzen.

Nie in diese Datei und nie ins Repo: Passwoerter, die Team-ID, Schluesseldateien, Telefonnummern. Solche Zeilen sagen nur, wo der Wert eingetragen wird.

## Adressen und Namen

| Kennung | Wofuer | Vorschlag aus dem Repo | Wo es eingetragen wird |
|---|---|---|---|
| `{{FIRMENNAME}}` | Name des Anbieters im Store (Entwicklername, Verkaeufer) | `PurpleDoubleD` (`bundle.publisher` in `src-tauri/tauri.conf.json`). Ob das der rechtliche Name ist, weiss nur David | Play Console (Entwicklerkonto), App Store Connect (Vertraege) |
| `{{COPYRIGHT}}` | Copyright-Zeile im App Store | `2026 PurpleDoubleD` (aus `bundle.copyright`) | App Store Connect, App-Information |
| `{{SUPPORT_EMAIL}}` | Kontaktadresse im Store | `hello@lu-labs.ai` (`SUPPORT_EMAIL` in `e2e/mobile/store-rules.ts`, dieselbe Adresse zeigt die App) | Play: Store-Eintrag, Kontaktdaten. Apple: App Review Information |
| `{{SUPPORT_URL}}` | Support-Seite (Apple verlangt eine Adresse, keine Mail) | `https://lu-labs.ai/support`. Live seit 14.10.2026 (Webseite `feat/web-307-store`): Kontakt per Mail, Wege zu Loeschseite, Datenschutz und Bedingungen, Titel "LU support", kein langer Produktname, kein Link zu Preisen (abgerufen 14.10.). Die App selbst nennt weiter die Mailadresse | App Store Connect, Support URL |
| `{{MARKETING_URL}}` | Webseite der App (freiwillig) | `https://lu-labs.ai` (`bundle.homepage`). Achtung: die Seite fuehrt zu Preisen, im Store-Bau oeffnet die App sie deshalb nicht | Play: Website. Apple: Marketing URL |
| `{{PRIVACY_URL}}` | Datenschutzerklaerung | `https://lu-labs.ai/privacy` (`LEGAL_LINKS`). Seit 14.10.2026 mit der Handy-App (Pruefersicht R6), Adresse unveraendert | beide Stores, Pflicht |
| `{{TERMS_URL}}` | Nutzungsbedingungen | `https://lu-labs.ai/terms` (`LEGAL_LINKS`). Seit 14.10.2026 mit den Handy-Apps, Adresse unveraendert | Apple: EULA (oder Apples Standard waehlen) |
| `{{ACCOUNT_DELETE_URL}}` | Seite, auf der man das Konto ohne die App loeschen kann | `https://lu-labs.ai/delete-account` (`LEGAL_LINKS`, seit Runde 32). Eigene Seite der Webseite, live seit 14.10.2026: nennt die App, die Schritte in der App und im Web, was geloescht und was behalten wird, ohne Anmeldung lesbar, kein Link zu Preisen (Pruefersicht R7) | Play: Datensicherheit, Abschnitt Kontoloeschung |

## Pruefer

| Kennung | Wofuer | Vorschlag | Wo es eingetragen wird |
|---|---|---|---|
| `{{REVIEW_ACCOUNT_EMAIL}}` | Testkonto fuer die Pruefer, mit Passwort (nicht nur ueber Google oder GitHub angelegt) und mit Guthaben fuer einige Cloud-Auftraege. Die Hinweise an Apple sagen zu, dass es Guthaben hat (`APPSTORE-EINTRAG.md` 9) | keiner, David legt es an | Play: App-Zugriff. Apple: App Review Information, Sign-in required |
| `{{REVIEW_ACCOUNT_PASSWORD}}` | Passwort des Testkontos | nie ins Repo | nur im Formular des Stores |
| `{{REVIEW_CONTACT_NAME}}` | Ansprechperson fuer Rueckfragen der Pruefer | keiner | Apple: App Review Information |
| `{{REVIEW_CONTACT_EMAIL}}` | Mail der Ansprechperson | keiner | Apple: App Review Information |
| `{{REVIEW_CONTACT_PHONE}}` | Telefon der Ansprechperson | nie ins Repo | nur im Formular des Stores |

## Entscheidungen, die in den Texten stehen

| Kennung | Frage | Was die Eintraege heute annehmen |
|---|---|---|
| `{{APP_NAME_PLAY}}` | Name im Play Store (hoechstens 30 Zeichen). Entschieden am 10.10.2026 | `LU`, nichts dahinter. Die App selbst heisst im Store-Bau `LU` |
| `{{APP_NAME_APPSTORE}}` | Name im App Store (hoechstens 30 Zeichen), muss dort frei sein. Entschieden am 10.10.2026 | `LU`. Ist der Name vergeben, entscheidet David ueber einen Zusatz |

## Nur im Bau, nicht in den Texten

Diese Werte gehoeren in die Umgebung des Release-Befehls (`RELEASE-KNOPF.md`), nicht in eine Datei.

| Wert | Variable |
|---|---|
| Adresse des Meldedienstes | `VITE_LU_REPORT_URL`, Wert `https://lu-labs.ai/api/reports` (live seit 14.10.2026, oeffentliche Adresse; in den lokalen Release-Werten gesetzt) |
| Android-Schluessel | `LU_ANDROID_KEY_PROPERTIES` (Pfad zur `key.properties`) |
| Apple-Team | `APPLE_DEVELOPMENT_TEAM` |
| Kennung der iOS-App | `LU_IOS_BUNDLE_ID` (heute im Projekt: `com.purpledoubled.lu`) |
| Schluessel fuer App Store Connect | `APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` |
| Dienstkonto fuer Google Play | `LU_PLAY_SERVICE_ACCOUNT_JSON` |

## Angaben zum Anbieter, die beide Stores abfragen

Ohne Kennung, weil sie in keinem Text stehen, aber nur David sie kennt:

- Art des Entwicklerkontos: Unternehmen oder Privatperson (Frage 6 in `FUER-DAVID.md`).
- Haendlerstatus nach dem Digital Services Act der EU, mit Anschrift und Telefon. Beide Stores verlangen die Angabe, bevor eine App in der EU erscheint.
- Bei Google: die verifizierte Anschrift des Entwicklerkontos.
- Der Preis der App im Store. Die Eintraege nennen keinen und sagen nirgends, dass die App nichts kostet: das legt David in der Konsole fest.
