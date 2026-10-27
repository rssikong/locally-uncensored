//! Die Namen der app-eigenen Verzeichnisse — an EINER Stelle.
//!
//! ## Warum es diese Datei gibt
//!
//! Der Verzeichnisname wird auf der Rust-Seite **nicht** aus der
//! Tauri-`identifier` abgeleitet. Er stand als String an acht Stellen im
//! Quelltext, jede davon ein `dirs::*` plus ein angehängtes Literal. Ein
//! eigener `identifier` in `tauri.conf.json` trennt deshalb WebView-Speicher
//! und Single-Instance-Socket, aber eben nicht diese Pfade.
//!
//! Was daran gefährlich ist, hat sich am 2026-08-31 gezeigt: ein Build, der
//! sich für eine andere App hielt, schrieb in
//! `~/Library/Application Support/lu-labs/`, überschrieb dort
//! `stores/store_backup.json` und setzte `lu-providers` auf den Zustand eines
//! fremden Laufs zurück. Dass 6,7 MB echter Chats überlebt haben, lag allein
//! an der Merge-Rettung in `commands::system` (`keys_lost` / `merged_backup`)
//! — ein Sicherheitsnetz, keine Trennung.
//!
//! ## Wie es jetzt läuft
//!
//! Jeder Name, den diese App auf der Platte und im Schlüsselbund besitzt,
//! steht genau einmal hier und wird überall von hier geholt. Diese Konstanten
//! sind die Namen der echten App und dürfen sich nicht ändern: ein anderer
//! `APP_DIR` lässt die App die Daten des Nutzers nicht mehr finden, ein
//! anderer `KEYCHAIN_SERVICE` verwaist seine gespeicherten Schlüssel.
//!
//! Festgenagelt wird beides von zwei Tests:
//! [`tests::die_namen_sind_die_der_echten_app`] hält die fünf Werte fest, und
//! [`tests::keine_quelldatei_baut_einen_pfad_der_echten_app_von_hand`] liest
//! alle eigenen Quellen und findet jede Stelle, die einen dieser Namen wieder
//! selbst zusammensetzt statt ihn hier zu holen. Der zweite ist der
//! eigentliche Zweck der Datei: eine Sammelstelle, an der niemand vorbeikommt,
//! ist eine Sammelstelle, die nur so lange hält, wie das jemand prüft.
//!
//! ## Was hier NICHT drin steht
//!
//! * Die Tauri-`identifier` (`tauri.conf.json`) — sie steuert
//!   `app_data_dir()`/`app_config_dir()`, den Single-Instance-Socket und den
//!   WebView-Speicher **gebündelter** Builds.
//! * Der Binärname (`Cargo.toml`, `[package] name`) — er steuert unter macOS
//!   im `tauri dev`-Modus das WebKit-Verzeichnis (`~/Library/WebKit/<Name>`).

/// Haupt-Datenverzeichnis dieser App unter `data_local_dir()`, `cache_dir()`
/// und `config_dir()`.
///
/// * macOS:   `~/Library/Application Support/<APP_DIR>`
/// * Windows: `%LOCALAPPDATA%\<APP_DIR>`
/// * Linux:   `~/.local/share/<APP_DIR>`, `~/.cache/<APP_DIR>`,
///   `~/.config/<APP_DIR>`
pub const APP_DIR: &str = "lu-labs";

/// Älterer Ordner unter `config_dir()` bzw. `data_local_dir()`: hält
/// `config.json` (ComfyUI-Pfad/-Port, Ollama-Basis, Trainer-Root) und
/// `bin/cloudflared`.
pub const APP_CONFIG_DIR: &str = "locally-uncensored";

/// Die Anzeige-Schreibweise desselben Namens. Zwei Verwendungen:
/// `%APPDATA%\<APP_DISPLAY_DIR>` (Store-Backups + Onboarding-Marker, Windows)
/// und `<data_dir>/<APP_DISPLAY_DIR>/models` (Modelle der eingebauten Engine).
pub const APP_DISPLAY_DIR: &str = "Locally Uncensored";

/// Sandkasten-Wurzel der Agenten unter `$HOME`. Pro Chat entsteht darin ein
/// Unterordner; der Agent darf nichts außerhalb anfassen.
pub const AGENT_WORKSPACE_DIR: &str = "agent-workspace";

/// Service-Name im OS-Schlüsselbund (macOS Keychain / Windows Credential
/// Manager) für Provider-Schlüssel und die Cloud-Sitzung.
///
/// Gehört hierher, obwohl es kein Pfad ist: der Name war ebenfalls
/// hartkodiert, und wer ihn ändert, verwaist alle Schlüssel, die der Nutzer
/// unter dem alten Namen gespeichert hat. Ein Build mit einem abweichenden
/// Service-Namen liest und **überschreibt** außerdem fremde Einträge.
// Only the Windows and macOS keychain paths read this; Linux has no keychain
// backend yet, and its clippy gate runs with -D warnings.
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub const KEYCHAIN_SERVICE: &str = "com.locallyuncensored.providerkeys";

// ---------------------------------------------------------------------------
// The product name in texts and in outgoing calls
// ---------------------------------------------------------------------------
//
// The phone packages are called "LU" and nothing else (decision of
// 10.10.2026). A text a phone can show, a file a phone can write and a
// header a phone sends to a server must not carry the long name, and the
// program must not contain it either: an automatic store check reads the
// binary. The desktop keeps every wording it has today, byte for byte.
//
// Both wordings live here and nowhere else. `desktop_wording` is the only
// place in the crate that may spell the long name in a text or a header, and
// it is not compiled into a phone build at all. `phone_wording` is compiled
// everywhere so that the desktop test run holds it too.
// `src/lib/__tests__/mobile-name-im-programm.test.ts` reads the sources and
// fails on any other spelling; `scripts/mobile/release/pruefe-name-im-paket.sh`
// reads a finished package.

#[cfg(not(mobile))]
mod desktop_wording {
    /// The name in sentences and in the header of files the app writes.
    pub const PRODUCT_NAME: &str = "Locally Uncensored";

    /// `User-Agent` of a plain outgoing call. The number is the one each call
    /// site has always sent; it is not the app version.
    macro_rules! outgoing_agent {
        ($sent_version:literal) => {
            concat!("LocallyUncensored/", $sent_version)
        };
    }
    pub(crate) use outgoing_agent;

    /// `User-Agent` that carries the running app version.
    pub fn outgoing_agent_for(version: &str) -> String {
        format!("LocallyUncensored/{version}")
    }

    /// How the app names itself in the client field of You.com's search
    /// (commands/search_tiers.rs, 3.0.8).
    pub const CLIENT_SLUG: &str = "locally-uncensored";

    /// `User-Agent` of the page fetch the agent tools use.
    pub const AGENT_FETCH_USER_AGENT: &str = "Mozilla/5.0 (compatible; LocallyUncensored-Agent/1.0)";

    /// Environment entry for the SearXNG container the desktop can install.
    pub const SEARXNG_INSTANCE_ENV: &str = "INSTANCE_NAME=locally-uncensored";
}

// Compiled into every build. A desktop build uses none of it outside the tests.
#[cfg_attr(not(mobile), allow(dead_code, unused_imports, unused_macros))]
pub(crate) mod phone_wording {
    pub const PRODUCT_NAME: &str = "LU";

    /// The version of the phone package (3.0.7 while the crate says 3.0.5):
    /// read by `build.rs` from the config of the platform, where
    /// `scripts/mobile/release/version-setzen.sh` puts it (`phone_version.rs`).
    /// In a desktop build this is the version of the crate.
    pub const APP_VERSION: &str = env!("LU_PHONE_VERSION");

    /// One agent for every plain call: the name and the version of the
    /// package. No repository address and no domain.
    pub const OUTGOING_AGENT: &str = concat!("LU/", env!("LU_PHONE_VERSION"));

    macro_rules! outgoing_agent {
        ($sent_version:literal) => {
            $crate::app_identity::phone_wording::OUTGOING_AGENT
        };
    }
    pub(crate) use outgoing_agent;

    pub fn outgoing_agent_for(version: &str) -> String {
        format!("LU/{version}")
    }

    pub const CLIENT_SLUG: &str = "lu";

    pub const AGENT_FETCH_USER_AGENT: &str = "Mozilla/5.0 (compatible; LU-Agent/1.0)";

    /// No phone installs a container. The entry exists so that the shared
    /// code has one name on both sides.
    pub const SEARXNG_INSTANCE_ENV: &str = "INSTANCE_NAME=lu";
}

/// The version this app calls itself in its log. The desktop: the version
/// of the crate, as before. A phone: the version of its package.
///
/// On the desktop: the version of this build, for every log line, diagnostic and request the
/// Rust side writes. The one place that reads it: a Discord report (3.0.7) had
/// a 3.0.6 user reading "3.0.5" in the logs, and the version was asked for in
/// seven places from two sources (Cargo.toml and, through `package_info`,
/// tauri.conf.json). Both files are held equal to package.json by
/// `src/lib/__tests__/eine-versionsquelle.test.ts`, which also refuses any
/// second reader here.
#[cfg(not(mobile))]
pub(crate) const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
#[cfg(mobile)]
pub(crate) const APP_VERSION: &str = phone_wording::APP_VERSION;

#[cfg(not(mobile))]
pub(crate) use desktop_wording::{
    outgoing_agent, outgoing_agent_for, AGENT_FETCH_USER_AGENT, CLIENT_SLUG, PRODUCT_NAME,
    SEARXNG_INSTANCE_ENV,
};
#[cfg(mobile)]
pub(crate) use phone_wording::{
    outgoing_agent, outgoing_agent_for, AGENT_FETCH_USER_AGENT, CLIENT_SLUG, PRODUCT_NAME,
    SEARXNG_INSTANCE_ENV,
};

#[cfg(test)]
mod tests {
    use super::*;

    /// Die Namen, die dieser App gehören.
    ///
    /// Bewusst als eigene Literale wiederholt und **nicht** aus den
    /// Konstanten oben abgeleitet: ein Test, der seine Erwartung aus dem holt,
    /// was er absichern soll, prüft nichts.
    const NAMEN_DER_ECHTEN_APP: [&str; 4] = [
        "lu-labs",
        "locally-uncensored",
        "Locally Uncensored",
        "agent-workspace",
    ];

    /// Ein Build, der unter einem anderen Namen läuft, findet die Daten des
    /// Nutzers nicht mehr und legt daneben neue an. Genau das ist am
    /// 2026-08-31 passiert, nur in die andere Richtung. Die fünf Werte stehen
    /// deshalb doppelt: einmal als Auslieferungscode, einmal hier.
    #[test]
    fn die_namen_sind_die_der_echten_app() {
        assert_eq!(APP_DIR, "lu-labs");
        assert_eq!(APP_CONFIG_DIR, "locally-uncensored");
        assert_eq!(APP_DISPLAY_DIR, "Locally Uncensored");
        assert_eq!(AGENT_WORKSPACE_DIR, "agent-workspace");
        assert_eq!(KEYCHAIN_SERVICE, "com.locallyuncensored.providerkeys");
        // Und kein Name trägt einen Anhang: ein Build aus einem
        // Experimentierzweig darf nicht versehentlich ausgeliefert werden.
        for name in [APP_DIR, APP_CONFIG_DIR, APP_DISPLAY_DIR, AGENT_WORKSPACE_DIR] {
            assert!(
                NAMEN_DER_ECHTEN_APP.contains(&name),
                "'{name}' ist keiner der Namen dieser App"
            );
        }
    }

    /// The desktop sends and writes exactly what it did before the wording
    /// moved here. Literals on purpose, see `NAMEN_DER_ECHTEN_APP`.
    #[cfg(not(mobile))]
    #[test]
    fn der_desktop_behaelt_jeden_wortlaut() {
        assert_eq!(PRODUCT_NAME, "Locally Uncensored");
        assert_eq!(outgoing_agent!("1.5"), "LocallyUncensored/1.5");
        assert_eq!(outgoing_agent!("2.0"), "LocallyUncensored/2.0");
        assert_eq!(outgoing_agent!("2.3"), "LocallyUncensored/2.3");
        assert_eq!(outgoing_agent!("2.6"), "LocallyUncensored/2.6");
        assert_eq!(outgoing_agent!("3.0"), "LocallyUncensored/3.0");
        assert_eq!(outgoing_agent_for("3.0.5"), "LocallyUncensored/3.0.5");
        assert_eq!(CLIENT_SLUG, "locally-uncensored");
        assert_eq!(AGENT_FETCH_USER_AGENT, "Mozilla/5.0 (compatible; LocallyUncensored-Agent/1.0)");
        assert_eq!(SEARXNG_INSTANCE_ENV, "INSTANCE_NAME=locally-uncensored");
        // The one sentence that takes the name from here, whole.
        assert_eq!(
            crate::commands::download::http_error_message(404, "m.gguf"),
            "m.gguf is not at this address any more (HTTP 404). The repository was renamed, moved or taken down, so trying again cannot help. Look for a newer version of this model in the Model Manager, or update Locally Uncensored \u{2014} the address is part of the app's catalog."
        );
    }

    /// Android review, known remainder: the status of the remote door and the
    /// health report still said the version of the crate (3.0.5) on a phone.
    /// Both say `APP_VERSION` now, which is the crate version on a desktop and
    /// the package version on a phone. Read from the source on purpose: the
    /// desktop test run cannot see a phone build.
    #[test]
    fn die_meldestellen_nennen_die_version_des_pakets() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        for file in ["health.rs", "remote.rs"] {
            let text = std::fs::read_to_string(root.join(file)).expect("source readable");
            assert!(
                !text.contains("env!(\"CARGO_PKG_VERSION\")"),
                "{file} reports the crate version, not the version of the package (use app_identity::APP_VERSION)"
            );
            assert!(text.contains("app_identity::APP_VERSION"), "{file} must report app_identity::APP_VERSION");
        }
    }

    /// What a phone build says and sends. The module is compiled on the
    /// desktop too, so this runs in the ordinary test run.
    #[test]
    fn das_handy_nennt_nur_lu() {
        // The version of the package, not of the crate (round 22, N13). In this
        // desktop test run the build script hands in the version of the crate.
        let version = env!("LU_PHONE_VERSION");
        assert_eq!(phone_wording::APP_VERSION, version);
        #[cfg(not(mobile))]
        assert_eq!(version, env!("CARGO_PKG_VERSION"), "a desktop build never reads a phone version");
        #[cfg(not(mobile))]
        assert_eq!(APP_VERSION, env!("CARGO_PKG_VERSION"), "the desktop log names the version of the crate, as before");
        let alle = [
            phone_wording::PRODUCT_NAME.to_string(),
            phone_wording::OUTGOING_AGENT.to_string(),
            phone_wording::outgoing_agent!("2.0").to_string(),
            phone_wording::outgoing_agent_for("3.0.7"),
            phone_wording::CLIENT_SLUG.to_string(),
            phone_wording::AGENT_FETCH_USER_AGENT.to_string(),
            phone_wording::SEARXNG_INSTANCE_ENV.to_string(),
        ];
        assert_eq!(alle[0], "LU");
        assert_eq!(alle[1], format!("LU/{version}"));
        assert_eq!(alle[2], alle[1], "every plain call sends the same agent");
        assert_eq!(alle[3], "LU/3.0.7");
        assert_eq!(alle[4], "lu");
        assert_eq!(alle[5], "Mozilla/5.0 (compatible; LU-Agent/1.0)");
        for text in &alle {
            let klein = text.to_lowercase();
            for teil in ["uncensored", "github.com", "purpledoubled"] {
                assert!(!klein.contains(teil), "'{text}' traegt '{teil}'");
            }
        }
    }

    #[test]
    fn keine_quelldatei_baut_einen_pfad_der_echten_app_von_hand() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut funde: Vec<String> = Vec::new();

        for eintrag in walkdir::WalkDir::new(&src)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| x == "rs"))
        {
            let Ok(inhalt) = std::fs::read_to_string(eintrag.path()) else {
                continue;
            };
            for name in NAMEN_DER_ECHTEN_APP {
                for nadel in [
                    format!(".join(\"{name}\")"),
                    format!("starts_with(\"{name}\")"),
                    format!("\"{name}*\""),
                    format!("\"{name}/"),
                    format!("\"{name}\\\\"),
                ] {
                    if inhalt.contains(&nadel) {
                        funde.push(format!(
                            "{}: {nadel}",
                            eintrag.path().strip_prefix(&src).unwrap_or(eintrag.path()).display()
                        ));
                    }
                }
            }
        }

        assert!(
            funde.is_empty(),
            "Pfade der ECHTEN App im Quelltext zusammengebaut — jeder dieser Namen \
             gehört über die Konstanten in app_identity abgeleitet:\n  {}",
            funde.join("\n  ")
        );
    }
}
