# StoreKit-Konfiguration fuer lokale Tests

`LU-Beispiel.storekit` ist eine StoreKit-Konfigurationsdatei mit zwei Beispielprodukten (Verbrauchsgueter) fuer den Simulator. Sie gehoert zum In-App-Kauf von Guthaben, der gebaut und ausgeschaltet ist (`mobile-docs/r17/in-app-kauf-gebaut.md`).

- Die Datei ist in keinem Schema eingetragen und liegt in keinem Ordner, den `project.yml` als Quelle oder Ressource nennt. Sie kommt in kein Paket. `src/mobile/__tests__/iap-storekit-datei.test.ts` haelt das.
- Benutzen: in Xcode das Schema duplizieren (nicht das geteilte aendern), dort unter Run, Options, "StoreKit Configuration" diese Datei waehlen. Das Duplikat nicht committen.
- Die Preise in der Datei sind Platzhalter, die das Format verlangt. Sie sind keine Preise von LU. Echte Produkte, Namen und Preise stehen nur in App Store Connect.
- Die Datei wurde von Hand nach dem Format von Xcode 15 geschrieben und in dieser Runde nicht in Xcode geoeffnet (kein Xcode-Lauf erlaubt). Meldet Xcode sie als unlesbar: in Xcode eine neue Konfiguration anlegen und die zwei Produktkennungen uebernehmen.
