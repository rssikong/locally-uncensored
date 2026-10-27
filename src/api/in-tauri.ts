/**
 * `isTauri()` ohne Gepäck: dieses Modul importiert keinen Store.
 *
 * A24 (A12-Echtlauf, 21.10.2026): `main.tsx` lädt `lib/background-shutdown`
 * statisch, und das holte sich `isTauri` aus `api/backend`, das seinerseits
 * `settingsStore` importiert. Damit hydrierte das Hauptfenster seine
 * Einstellungen beim Seitenstart, VOR `awaitOnboardingHandover`, mit dem
 * leeren Stand. Der Assistent drüben schrieb `onboardingDone: true`, das
 * Hauptfenster las danach seinen alten Stand aus dem Speicher und zeigte das
 * Onboarding ein zweites Mal (bei „Re-run onboarding" jedes Mal, beim
 * Erststart nur, wenn der Restore es nicht zufällig heilte).
 * `api/backend` reicht diese Funktion unverändert weiter.
 */
import { prop } from "../types/json-guards";

/** True when running inside a Tauri WebView (.exe), false in browser dev mode */
export function isTauri(): boolean {
  // Tauri v2 renamed the global from `__TAURI__` to `__TAURI_INTERNALS__`.
  // Check both so the app keeps working across both versions (and also
  // during the migration window when people might be on either).
  if (typeof window === "undefined") return false;
  // Neither global is in the DOM lib, so reading them off `window` needed an
  // assertion. `prop` answers `undefined` for a missing key without claiming
  // anything about the container — the same probe, checked.
  const w: unknown = window;
  return !!(prop(w, "__TAURI_INTERNALS__") || prop(w, "__TAURI__"));
}
