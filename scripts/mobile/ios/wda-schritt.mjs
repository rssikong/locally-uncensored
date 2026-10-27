// Kleines Werkzeug zum Erkunden nativer Oberflaeche: haengt sich an die laufende App,
// tippt der Reihe nach auf die uebergebenen Beschriftungen und gibt danach die sichtbaren Beschriftungen aus.
// Aufruf: node scripts/mobile/ios/wda-schritt.mjs <udid> <bundle-id> [Beschriftung ...]
// Eine Beschriftung der Form @x,y tippt auf Bildschirmkoordinaten.
import { Wda } from "./ios-wda.mjs";
const [udid, bundleId, ...schritte] = process.argv.slice(2);
const w = await new Wda().start({ udid, bundleId });
try {
  for (const sch of schritte) {
    if (sch.startsWith("@")) {
      const [x, y] = sch.slice(1).split(",").map(Number);
      await w.tapPunkt(x, y);
    } else {
      await w.tippeAufText(sch);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const alert = await w.alertText();
  if (alert) console.log("ALERT:", alert);
  console.log((await w.beschriftungen()).filter((x) => !/scroll bar/.test(x)).join(" | "));
} finally {
  await w.ende();
}
