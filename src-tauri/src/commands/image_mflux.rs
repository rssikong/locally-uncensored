//! The second image engine: `mflux`, image models in native MLX.
//!
//! The first engine is the sidecar in `commands::mlx`, diffusers on the Metal
//! backend. It loads full precision repositories and has no pipeline for
//! Qwen-Image 2.1. `mflux` runs that model, and it runs packs that are
//! quantized already, which is what brings the large models to Macs with 16 to
//! 48 GB.
//!
//! This is a child module of `commands::mlx`: the catalogue, the install slot
//! and the hub helpers are that file's, and what is its own is here. The
//! engine lives in a venv of its own. It asks for `torch>=2.13` and MLX 0.32,
//! and the sidecar's venv is pinned to `torch==2.12.1`, so the two cannot
//! share one environment.
//!
//! Every statement about the command line below was read from the engine's
//! source at release 0.22.0 (commit 31c9640, `cli/parser/parsers.py`,
//! `models/qwen21/cli/qwen21_edit_generate.py`, `models/z_image/cli/`,
//! `models/flux2/cli/`, `models/qwen/cli/`, `callbacks/callback_manager.py`,
//! `models/common/resolution/`), and the four command lines were run in a
//! venv built from the pins below up to the point where the model folder is
//! resolved, 08.10.2026. No image was generated with it yet.
//!
//! Editing came the same day and the same way: `--image-paths`,
//! `--output-resolution`, `--guidance` and `--negative-prompt` of the
//! Qwen-Image 2.1 command were read from `qwen21_edit_generate.py`,
//! `variants/edit/qwen_image_21_edit.py` and
//! `latent_creator/qwen_image21_latent_creator.py`, and the lines this file
//! builds for an edit were run up to the same point. What Windows offers for
//! this model and what of it runs here is in
//! `lu-astra/proof/mac/QWEN-21-PARITAET.md`.

use super::{apply_hf_token, fetch_repo_listing, images_root, run_hub_step, truncate, ImageCatalogEntry};
use crate::commands::video::{base_python_or_own, run_streamed};
use crate::commands::CmdResult;
use crate::install_state::InstallSlot;
use crate::os_error;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// The release the engine is installed at. The project ships a release a week
/// and renames flags between them, so nothing here follows "latest".
pub(super) const VERSION: &str = "0.22.0";

/// The wheel from PyPI at that release, and the versions its author's
/// `uv.lock` names for the packages it stands on. Left open, pip takes
/// whatever was released this morning on a customer's Mac, untested.
/// A wheel and no `git+` address: pip would need `git` for that, and a Mac
/// without the Xcode tools has none.
const PINNED: [&str; 11] = [
    "mflux==0.22.0",
    "mlx==0.32.0",
    "torch==2.13.0",
    "transformers==5.15.0",
    "huggingface-hub==1.28.0",
    "tokenizers==0.22.2",
    "safetensors==0.8.0",
    "numpy==2.4.1",
    "pillow==12.3.0",
    "opencv-python==4.13.0.90",
    "sentencepiece==0.2.1",
];

/// The module the engine imports as.
const MODULE: &str = "mflux";

/// What the venv takes on disk once pip is through (measured: 1.2 GB), with
/// room for the wheels pip keeps while it unpacks them.
const ENGINE_INSTALL_BYTES: u64 = 2_000_000_000;

/// A generation that is still running after this long is not going to end.
const GENERATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60 * 60);

// ── What the engine runs ──────────────────────────────────────────────

/// The command of the engine a pack is run through. Each is a module of its
/// own with its own flags.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Family {
    /// Qwen-Image 2.1 through the entry point that reads complete packs: the
    /// text encoder quantized, with its vision part. Without a reference
    /// image it makes an image from text, and with one or more it edits.
    Qwen21,
    ZImageTurbo,
    Flux2Klein4b,
    /// Qwen-Image 2512, the 20B model.
    QwenImage,
    /// SeedVR2, the upscaler: no prompt, one picture in, the same picture
    /// larger out, in one step. Enhance Image runs it (`upscale`).
    SeedVR2,
}

impl Family {
    /// What follows `python -m`. The module and not the script in `bin/`: its
    /// first line names the interpreter by path, and that path has a space in
    /// it on every Mac ("Application Support").
    const fn module(self) -> &'static str {
        match self {
            Family::Qwen21 => "mflux.models.qwen21.cli.qwen21_edit_generate",
            Family::ZImageTurbo => "mflux.models.z_image.cli.z_image_turbo_generate",
            Family::Flux2Klein4b => "mflux.models.flux2.cli.flux2_generate",
            Family::QwenImage => "mflux.models.qwen.cli.qwen_image_generate",
            // The entry point `mflux-upscale-seedvr2` (the wheel's
            // entry_points.txt names this module and its `main`).
            Family::SeedVR2 => "mflux.models.seedvr2.cli.seedvr2_upscale",
        }
    }

    /// The built-in model a pack is a copy of. Said out loud with
    /// `--base-model`: left out, the engine reads it off the folder's name.
    const fn base_model(self) -> &'static str {
        match self {
            Family::Qwen21 => "qwen-image-2.1",
            Family::ZImageTurbo => "z-image-turbo",
            Family::Flux2Klein4b => "flux2-klein-4b",
            Family::QwenImage => "qwen-image",
            // Never said: the upscale command lists `--base-model` among the
            // options it ignores (`IGNORED_OPTIONS` in `seedvr2_upscale.py`).
            // It reads the variant off the file names in the folder.
            Family::SeedVR2 => "",
        }
    }

    /// The parts of a repository the command reads: a folder (with its
    /// slash) or one file at the root. Cards, licences and banners stay on
    /// the hub.
    const fn parts(self) -> &'static [&'static str] {
        match self {
            Family::Qwen21 => &["model_index.json", "scheduler/", "processor/", "vae/", "transformer/", "text_encoder/"],
            // The two files the 3B model loads and no other
            // (`SeedVR2WeightDefinition3B.get_download_patterns`). The repository
            // also holds the 7B model and fp8 copies, 60 GB that stay there.
            Family::SeedVR2 => &[SEEDVR2_3B_TRANSFORMER, SEEDVR2_VAE],
            _ => &["tokenizer/", "text_encoder/", "transformer/", "vae/"],
        }
    }

    /// Whether `--guidance` and `--negative-prompt` reach the model. Z-Image
    /// Turbo is sampled without guidance, and the FLUX.2 command ends with an
    /// error on a negative prompt. Qwen-Image 2.1 is trained without guidance
    /// and runs at 1 by default, where its command skips the negative pass,
    /// and it takes both from 1 upwards.
    const fn takes_guidance(self) -> bool {
        matches!(self, Family::QwenImage | Family::Qwen21)
    }

    /// How many images the command takes with `--image-paths`, the one that
    /// is edited included. 0: the command makes images from text alone.
    const fn max_images(self) -> usize {
        match self {
            Family::Qwen21 => 10,
            _ => 0,
        }
    }

    /// The guidance a command runs at when it is given no flag for it, as
    /// read from the engine at 0.22.0: Z-Image Turbo sets 0 for a model
    /// without guidance (`variants/z_image.py`), the FLUX.2 and the
    /// Qwen-Image 2.1 command fall back to 1 (`flux2_generate.py`,
    /// `qwen21_edit_generate.py`). Qwen-Image always gets the flag.
    const fn own_guidance(self) -> f32 {
        match self {
            Family::ZImageTurbo => 0.0,
            _ => 1.0,
        }
    }

    /// Qwen-Image 2.1 refuses to start below two steps.
    const fn min_steps(self) -> u32 {
        match self {
            Family::Qwen21 => 2,
            _ => 1,
        }
    }
}

/// A LoRA that a catalogue entry runs its pack with.
#[derive(Debug)]
pub(super) struct Lora {
    pub repo: &'static str,
    pub revision: &'static str,
    pub file: &'static str,
    pub bytes: u64,
    /// The schedule the adapter was trained on, and the one step count that
    /// schedule has. The engine ends with an error on any other.
    pub scheduler: &'static str,
    pub steps: u32,
}

/// What a catalogue entry of this engine adds to `ImageCatalogEntry`. The
/// repository is the entry's own `repo`.
#[derive(Debug)]
pub(super) struct Pack {
    /// The folder under `models_root()`. Two entries that name the same one
    /// run on one download.
    pub dir: &'static str,
    /// The commit the files are fetched at. A pack that its publisher
    /// replaces is then still the one whose size the catalogue states.
    pub revision: &'static str,
    pub family: Family,
    pub lora: Option<Lora>,
}

impl Pack {
    /// How many images an edit with this pack takes in all. 0: it does not edit.
    pub(super) const fn edit_images(&self) -> usize {
        self.family.max_images()
    }

    /// Whether a run takes the user's LoRA stack. Every command of this
    /// engine that makes a picture has `--lora`, so every such pack does.
    /// The upscaler has no such flag, and the sidecar has none either.
    pub(super) const fn takes_loras(&self) -> bool {
        !self.upscales()
    }

    /// Whether this pack enhances a picture instead of making one. Such an
    /// entry is for Enhance Image alone: Generate refuses it and Create does
    /// not list it as a model to make pictures with.
    pub(super) const fn upscales(&self) -> bool {
        matches!(self.family, Family::SeedVR2)
    }

    /// Whether the steps and the guidance of a run are the user's. Qwen-Image
    /// 2.1 takes both. With the Turbo adapter neither is: its schedule has six
    /// nodes and it was distilled without guidance. The other families run at
    /// what the catalogue says, as their packs are tuned to one count.
    pub(super) const fn user_sampling(&self) -> bool {
        matches!(self.family, Family::Qwen21) && self.lora.is_none()
    }
}

pub(super) const QWEN21_8BIT: Pack = Pack {
    dir: "qwen-image-2.1-8bit",
    revision: "2ba3e3f65e0d971c1ab9539833f637c8f4afd33d",
    family: Family::Qwen21,
    lora: None,
};

pub(super) const QWEN21_4BIT: Pack = Pack {
    dir: "qwen-image-2.1-4bit",
    revision: "235fd28de40d745382e9d7a33f008c7735ec21c2",
    family: Family::Qwen21,
    lora: None,
};

/// The 8-bit pack with the Viggle Turbo LoRA at rank 256, the file its card
/// says to use. Six steps on the adapter's own schedule.
pub(super) const QWEN21_TURBO: Pack = Pack {
    dir: QWEN21_8BIT.dir,
    revision: QWEN21_8BIT.revision,
    family: Family::Qwen21,
    lora: Some(Lora {
        repo: "Viggle/Qwen-Image-2.1-viggle-turbo",
        revision: "009a44a895ef85f7e643c80fdca9543795248867",
        file: "Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors",
        bytes: 1_359_147_904,
        scheduler: "viggle_turbo",
        steps: 6,
    }),
};

pub(super) const ZIMAGE_TURBO_4BIT: Pack = Pack {
    dir: "z-image-turbo-4bit",
    revision: "f427e257d8e6ffa03edd4d9ac554a05809da456c",
    family: Family::ZImageTurbo,
    lora: None,
};

pub(super) const ZIMAGE_TURBO_8BIT: Pack = Pack {
    dir: "z-image-turbo-8bit",
    revision: "4ccff28917346aa9daae49cd3c477cf5260a242c",
    family: Family::ZImageTurbo,
    lora: None,
};

pub(super) const FLUX2_KLEIN_4B_4BIT: Pack = Pack {
    dir: "flux2-klein-4b-4bit",
    revision: "794cd159538149ad9830848508c31f0ea7088e58",
    family: Family::Flux2Klein4b,
    lora: None,
};

pub(super) const QWEN_2512_8BIT: Pack = Pack {
    dir: "qwen-image-2512-8bit",
    revision: "e4ef7e9f747c721aeab69012ca4ff32d72a2e056",
    family: Family::QwenImage,
    lora: None,
};

/// The transformer and the VAE of SeedVR2 3B, by the names the engine loads
/// them under (`models/seedvr2/weights/seedvr2_weight_definition.py`). The
/// upscale command takes the 3B model for a folder that has the first file
/// and not the one of the 7B model (`_resolve_seedvr2_model`).
const SEEDVR2_3B_TRANSFORMER: &str = "seedvr2_ema_3b_fp16.safetensors";
const SEEDVR2_VAE: &str = "ema_vae_fp16.safetensors";

/// SeedVR2 3B at full precision (fp16), from the repository the engine
/// fetches it from by itself (`model_config.py`, `seedvr2-3b`). Read from
/// the hub on 14.10.2026: 6,783,018,808 and 501,324,814 bytes, licence
/// Apache 2.0, as for the ByteDance-Seed originals it is copied from.
pub(super) const SEEDVR2_3B: Pack = Pack {
    dir: "seedvr2-3b",
    revision: "09ced71023636e9bc8cdf9cdecfb2625d1e691e8",
    family: Family::SeedVR2,
    lora: None,
};

// ── Where it lives ────────────────────────────────────────────────────

/// Beside the sidecar's venv, under the same app data folder.
pub(super) fn venv_dir() -> PathBuf {
    crate::os_paths::data_dir().join("mlx").join("venv-mflux")
}

fn venv_python(venv: &Path) -> PathBuf {
    venv.join("bin").join("python")
}

/// The packs, each in a folder of its own. Not the hub cache of the sidecar:
/// the engine is handed a folder, and a folder is what Remove takes away.
/// On a Mac it is under the app's data folder and not under its cache, which
/// the system and cleaning tools empty (`media_store`).
pub(super) fn models_root() -> PathBuf {
    crate::media_store::active_root(crate::media_store::Store::Mflux)
}

/// Where what a download or a run leaves behind and nobody reads again goes:
/// the app's cache folder for the app's packs, the folder itself otherwise.
pub(super) fn scratch(root: &Path) -> PathBuf {
    crate::media_store::scratch_beside(root, crate::media_store::Store::Mflux)
}

/// `HF_HOME` for the downloads, so the hub's chunk cache lands in a folder of
/// this app and not in the user's home folder.
pub(super) fn hf_home(root: &Path) -> PathBuf {
    scratch(root).join(".hf-cache")
}

fn pack_dir(root: &Path, pack: &Pack) -> PathBuf {
    root.join(pack.dir)
}

fn lora_dir(root: &Path, lora: &Lora) -> PathBuf {
    root.join("_loras").join(lora.repo.replace('/', "--"))
}

// ── Is the engine there ───────────────────────────────────────────────

/// Written when the install ran to its end. It records what was installed, so
/// a venv from an older pin does not pass for the current engine.
fn stamp_file(venv: &Path) -> PathBuf {
    venv.join(".lu-mflux-engine")
}

fn stamp() -> String {
    PINNED.join("\n")
}

fn ready_at(venv: &Path) -> bool {
    venv_python(venv).exists() && std::fs::read_to_string(stamp_file(venv)).is_ok_and(|s| s == stamp())
}

/// Whether the engine is installed, at the pinned release. Read from disk
/// alone: the catalogue asks this for every tile, every time it is drawn.
pub(super) fn engine_ready() -> bool {
    ready_at(&venv_dir())
}

fn python_has_module(python: &str, module: &str) -> bool {
    crate::python::python_command(python)
        .args(["-c", &format!("import {module}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// `<base> -m venv <dir>`, replacing whatever a stopped attempt left there.
fn create_venv(slot: &InstallSlot, base: &str, venv: &Path) -> Result<(), String> {
    if let Some(parent) = venv.parent() {
        std::fs::create_dir_all(parent).map_err(|e| os_error::english(&e))?;
    }
    slot.log(format!("creating the MLX image engine environment at {}", venv.display()));
    let mut cmd = crate::python::python_command(base);
    cmd.args(["-m", "venv", "--clear"]).arg(venv.as_os_str());
    run_streamed(slot, &mut cmd).map_err(|e| format!("Could not create the Python environment for the MLX image engine. {e}"))?;
    if !venv_python(venv).exists() {
        return Err("Python reported a new environment, but there is no interpreter in it.".to_string());
    }
    Ok(())
}

/// The engine's interpreter, with the engine installed first when it is not.
/// Called from a model install, so the engine arrives with the first model of
/// this engine and never before.
fn ensure_engine_at(slot: &InstallSlot, preferred_base: Option<String>, venv: &Path) -> Result<String, String> {
    let python = venv_python(venv).to_string_lossy().to_string();
    if ready_at(venv) {
        return Ok(python);
    }
    // A venv whose pip answers is one a stopped install left behind, and pip
    // continues in it. Anything less is built again from the start.
    if !(venv_python(venv).exists() && python_has_module(&python, "pip")) {
        // A Python found on this Mac, otherwise the one the app fetches for itself.
        let base = base_python_or_own(slot, preferred_base)?;
        slot.log(format!("Python: {base}"));
        create_venv(slot, &base, venv)?;
    }
    let _ = std::fs::remove_file(stamp_file(venv));
    slot.log(format!("installing the MLX image engine, mflux {VERSION} (one-time, about 1.2 GB)"));
    let mut pip = crate::python::python_command(&python);
    pip.args(["-m", "pip", "install", "--upgrade"]).args(PINNED);
    run_streamed(slot, &mut pip).map_err(|e| format!("Could not install the MLX image engine. {e}"))?;
    if !python_has_module(&python, MODULE) {
        return Err(format!("pip install finished but `import {MODULE}` still fails"));
    }
    std::fs::write(stamp_file(venv), stamp()).map_err(|e| os_error::english(&e))?;
    Ok(python)
}

// ── Is a pack there ───────────────────────────────────────────────────

/// Written into a pack's folder when every file of it is on disk at the size
/// the hub lists. It is what tells a whole pack from a download that was
/// stopped: a folder that merely has something in it proves nothing.
pub(super) const MANIFEST: &str = ".lu-pack.json";

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub(super) struct ManifestFile {
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub(super) struct Manifest {
    pub revision: String,
    pub files: Vec<ManifestFile>,
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_str(&std::fs::read_to_string(dir.join(MANIFEST)).ok()?).ok()
}

/// The files of `manifest` that are not in `dir` at their size.
pub(super) fn missing_files(dir: &Path, manifest: &Manifest) -> Vec<String> {
    manifest
        .files
        .iter()
        .filter(|f| std::fs::metadata(dir.join(&f.path)).map(|m| m.len()).ok() != Some(f.size))
        .map(|f| f.path.clone())
        .collect()
}

/// A pack is complete with its manifest and every file the manifest names.
/// A handful of `stat` calls: this runs for every tile.
pub(super) fn pack_complete(dir: &Path) -> bool {
    read_manifest(dir).is_some_and(|m| !m.files.is_empty() && missing_files(dir, &m).is_empty())
}

/// Bytes of a complete pack, 0 when there is none to measure.
// At the moment only the tests read it.
#[cfg_attr(not(test), allow(dead_code))]
fn pack_bytes(dir: &Path) -> u64 {
    read_manifest(dir).map(|m| m.files.iter().map(|f| f.size).sum()).unwrap_or(0)
}

/// The record that an entry was installed, in the folder of its pack.
///
/// A pack can be on disk for another entry: with Qwen-Image 2.1 Turbo
/// installed, every file of the plain 8-bit entry is there, and without this
/// it would read as installed without anyone having asked for it. Remove then
/// had nothing it could take away, and the tile contradicted the button.
pub(super) fn claim(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!(".lu-used-by-{id}"))
}

fn claims(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str().and_then(|n| n.strip_prefix(".lu-used-by-")).map(str::to_string))
        .collect()
}

fn lora_present(root: &Path, lora: &Lora) -> bool {
    std::fs::metadata(lora_dir(root, lora).join(lora.file)).map(|m| m.len()).ok() == Some(lora.bytes)
}

fn installed_at(root: &Path, id: &str, pack: &Pack) -> bool {
    let dir = pack_dir(root, pack);
    claim(&dir, id).is_file() && pack_complete(&dir) && pack.lora.as_ref().is_none_or(|l| lora_present(root, l))
}

/// Installed, and with the engine. This is what a tile and Generate ask. The
/// engine arrives with the first model, so a model whose engine is gone (or
/// is from an older pin) reads "not installed", and Get brings the engine
/// back without fetching the weights again.
pub(super) fn usable(id: &str, pack: &Pack) -> bool {
    installed_at(&models_root(), id, pack) && engine_ready()
}

// ── Install ───────────────────────────────────────────────────────────

fn wanted(family: Family, path: &str) -> bool {
    family.parts().iter().any(|part| if part.ends_with('/') { path.starts_with(part) } else { path == *part })
}

/// The files of a repository the engine reads, or why this is not a pack.
/// Each of the three components has to bring weights: the hub lists a
/// repository whose upload is still under way just the same.
fn plan(family: Family, listing: &[crate::commands::mlx_snapshot::RepoFile]) -> Result<Manifest, String> {
    let files: Vec<ManifestFile> = listing
        .iter()
        .filter(|f| wanted(family, &f.path))
        .map(|f| ManifestFile { path: f.path.clone(), size: f.size })
        .collect();
    if family == Family::SeedVR2 {
        // Two files at the root and no folders: each of them has to be there.
        for part in family.parts() {
            if !files.iter().any(|f| f.path == *part) {
                return Err(format!("The repository has no {part} and cannot be run. Try again later."));
            }
        }
        return Ok(Manifest { revision: String::new(), files });
    }
    for component in ["transformer/", "text_encoder/", "vae/"] {
        if !files.iter().any(|f| f.path.starts_with(component) && f.path.ends_with(".safetensors")) {
            return Err(format!(
                "The repository has no weights under {component} and cannot be run. Try again later."
            ));
        }
    }
    Ok(Manifest { revision: String::new(), files })
}

/// What an install still has to write: the pack, the LoRA and the engine,
/// each only as far as it is not there.
fn bytes_to_fetch(root: &Path, catalogue_bytes: u64, pack: &Pack, engine_ready: bool) -> u64 {
    let dir = pack_dir(root, pack);
    let lora = pack.lora.as_ref().map(|l| l.bytes).unwrap_or(0);
    let weights = if pack_complete(&dir) {
        0
    } else {
        // What a stopped attempt fetched is not needed a second time.
        catalogue_bytes.saturating_sub(lora).saturating_sub(crate::install_state::dir_size(&dir))
    };
    let lora = pack.lora.as_ref().filter(|l| !lora_present(root, l)).map(|l| l.bytes).unwrap_or(0);
    weights + lora + if engine_ready { 0 } else { ENGINE_INSTALL_BYTES }
}

pub(super) fn install(state: &AppState, entry: &'static ImageCatalogEntry, pack: &'static Pack) -> CmdResult {
    let root = models_root();
    let slot = state.install_mlx_image_model();
    if usable(entry.id, pack) {
        if slot.try_start() {
            slot.complete(format!("{} already installed", entry.id));
        }
        return Ok(json!({ "ok": true, "status": "complete", "id": entry.id }));
    }
    // Before a byte is fetched: a download that dies hours in with a full
    // disk leaves the Mac unusable and nothing to resume from.
    let need = bytes_to_fetch(&root, (entry.size_gb as f64 * 1e9) as u64, pack, engine_ready());
    let note = if engine_ready() { "" } else { "incl. the one-time MLX image engine" };
    crate::commands::system::ensure_free_space(&root, entry.name, need, note).map_err(crate::commands::bad_request)?;
    // The folder of the packs is made here and not by the first download,
    // so it is out of Time Machine before the gigabytes arrive.
    std::fs::create_dir_all(&root).map_err(|e| crate::commands::internal(os_error::english(&e)))?;
    crate::media_store::keep_out_of_backups(&root);
    // Check and claim in one step: of two clicks, one starts the install.
    if !slot.try_start() {
        return Ok(json!({ "ok": true, "status": "installing" }));
    }
    let preferred_base = state.python_bin();
    crate::install_state::spawn_install(slot, move |slot| {
        let python = ensure_engine_at(slot, preferred_base, &venv_dir())?;
        install_steps(slot, &python, &root, entry, pack)?;
        if !usable(entry.id, pack) {
            return Err("The download finished, but the model is not complete on disk. Start it again.".to_string());
        }
        Ok(format!("{} installed", entry.id))
    });
    Ok(json!({ "ok": true, "status": "installing", "id": entry.id }))
}

fn install_steps(slot: &InstallSlot, python: &str, root: &Path, entry: &ImageCatalogEntry, pack: &Pack) -> Result<(), String> {
    let dir = pack_dir(root, pack);
    // The LoRA an entry runs with is part of its download and lands beside
    // the packs. Left out of the bar, Turbo read "18.46 of 18.46 GB" for the
    // ten minutes in which its 1.4 GB adapter came in, and an install on a
    // pack that was there already had no bar at all (real run, 09.10.2026).
    let adapter = pack.lora.as_ref().filter(|l| !lora_present(root, l));
    let adapter_bytes = adapter.map(|l| l.bytes).unwrap_or(0);
    if pack_complete(&dir) {
        slot.log(format!("the files of {} are on disk already", pack.dir));
        if let Some(lora) = adapter {
            crate::install_state::watch_dir_size(slot.clone(), lora_dir(root, lora), vec![hf_home(root).join("xet")], adapter_bytes);
        }
    } else {
        // The hub says what the pack is made of, at the pinned commit. That
        // list is the download, and afterwards it is what the folder is held
        // against. A refusal comes back as the sentence about the token.
        slot.log(format!("asking the hub what {} holds", entry.repo));
        let listing = fetch_repo_listing(entry.repo, pack.revision)
            .map_err(|e| if super::is_hub_denied(&e) { e } else { format!("Could not read the file list of {}: {e}.", entry.repo) })?;
        let mut manifest = plan(pack.family, &listing)?;
        manifest.revision = pack.revision.to_string();
        let total: u64 = manifest.files.iter().map(|f| f.size).sum();
        slot.log(format!("downloading {} ({})", entry.repo, crate::commands::mlx_snapshot::human_bytes(total)));
        std::fs::create_dir_all(&dir).map_err(|e| os_error::english(&e))?;
        let _ = std::fs::remove_file(dir.join(MANIFEST));
        let beside: Vec<PathBuf> = std::iter::once(hf_home(root).join("xet")).chain(adapter.map(|l| lora_dir(root, l))).collect();
        crate::install_state::watch_dir_size(slot.clone(), dir.clone(), beside, total + adapter_bytes);
        let files: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
        hub_snapshot(slot, python, root, entry.repo, pack.revision, &dir, &files)?;
        let missing = missing_files(&dir, &manifest);
        if !missing.is_empty() {
            let shown: Vec<&str> = missing.iter().take(3).map(String::as_str).collect();
            return Err(format!("The download finished, but the model is missing {}. Start it again.", shown.join(", ")));
        }
        let record = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(MANIFEST), record).map_err(|e| os_error::english(&e))?;
    }
    if let Some(lora) = adapter {
        slot.log(format!("downloading the LoRA {} ({})", lora.file, crate::commands::mlx_snapshot::human_bytes(lora.bytes)));
        hub_file(slot, python, root, lora)?;
        if !lora_present(root, lora) {
            return Err(format!("The download finished, but {} is not complete on disk. Start it again.", lora.file));
        }
    }
    std::fs::write(claim(&dir, entry.id), b"").map_err(|e| os_error::english(&e))
}

/// Pull the named files of a repository into `target`, through
/// `huggingface_hub` in the engine's venv. Everything that varies goes in as
/// an argument and not into the source of the script, so no path and no file
/// name has to survive being quoted.
pub(super) fn hub_snapshot(slot: &InstallSlot, python: &str, root: &Path, repo: &str, revision: &str, target: &Path, files: &[&str]) -> Result<(), String> {
    const SCRIPT: &str = "import sys\nfrom huggingface_hub import snapshot_download\nsnapshot_download(repo_id=sys.argv[1], revision=sys.argv[2], local_dir=sys.argv[3], allow_patterns=sys.argv[4:])";
    let mut cmd = crate::python::python_command(python);
    cmd.args(["-c", SCRIPT, repo, revision]).arg(target.as_os_str()).args(files);
    hub_env(&mut cmd, root);
    let freed = super::drop_stale_partials(target);
    if freed > 0 {
        slot.log(format!("removed {} that a stopped download left half written", crate::commands::mlx_snapshot::human_bytes(freed)));
    }
    run_hub_step(slot, &mut cmd, &[target, &hf_home(root)])?;
    // What the attempts of this very step left (a stalled one that was
    // started again) is of no use once the files are whole.
    super::drop_stale_partials(target);
    Ok(())
}

fn hub_file(slot: &InstallSlot, python: &str, root: &Path, lora: &Lora) -> Result<(), String> {
    const SCRIPT: &str = "import sys\nfrom huggingface_hub import hf_hub_download\nhf_hub_download(repo_id=sys.argv[1], filename=sys.argv[2], revision=sys.argv[3], local_dir=sys.argv[4])";
    let target = lora_dir(root, lora);
    std::fs::create_dir_all(&target).map_err(|e| os_error::english(&e))?;
    let mut cmd = crate::python::python_command(python);
    cmd.args(["-c", SCRIPT, lora.repo, lora.file, lora.revision]).arg(target.as_os_str());
    hub_env(&mut cmd, root);
    run_hub_step(slot, &mut cmd, &[&target, &hf_home(root)])
}

fn hub_env(cmd: &mut std::process::Command, root: &Path) {
    cmd.env("HF_HOME", hf_home(root)).env("HF_XET_CACHE", hf_home(root).join("xet"));
    apply_hf_token(cmd);
}

// ── Remove ────────────────────────────────────────────────────────────

pub(super) fn delete(entry: &ImageCatalogEntry, pack: &Pack) -> CmdResult {
    if busy() {
        return Err(crate::commands::bad_request("An image is being generated. Wait for it to finish before deleting the model."));
    }
    delete_at(&models_root(), entry.id, pack).map_err(|e| match e {
        DeleteError::NotInstalled => crate::commands::not_found(format!("{} is not installed", entry.id)),
        DeleteError::Io(e) => crate::commands::internal(format!("delete {}: {e}", entry.id)),
    })?;
    Ok(json!({ "ok": true, "id": entry.id }))
}

#[derive(Debug, PartialEq)]
enum DeleteError {
    NotInstalled,
    Io(String),
}

/// What Remove does on disk. The entry's claim goes, and its LoRA. The pack
/// goes with the last entry that claims it, and so does a download that was
/// stopped before anyone could claim it.
fn delete_at(root: &Path, id: &str, pack: &Pack) -> Result<(), DeleteError> {
    let dir = pack_dir(root, pack);
    let own = claim(&dir, id);
    let others: Vec<String> = claims(&dir).into_iter().filter(|c| c != id).collect();
    let unclaimed_leftover = dir.is_dir() && others.is_empty();
    if !own.is_file() && !unclaimed_leftover {
        return Err(DeleteError::NotInstalled);
    }
    let _ = std::fs::remove_file(&own);
    if let Some(lora) = &pack.lora {
        let _ = std::fs::remove_dir_all(lora_dir(root, lora));
    }
    if others.is_empty() && dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| DeleteError::Io(os_error::english(&e)))?;
    }
    // The hub's chunk cache is download scratch that no model reads again.
    // No install is running (the command checks), so nothing writes there.
    let _ = std::fs::remove_dir_all(hf_home(root).join("xet"));
    Ok(())
}

// ── Generate ──────────────────────────────────────────────────────────

pub(super) struct Request {
    pub prompt: String,
    pub negative_prompt: Option<String>,
    pub steps: Option<u32>,
    pub guidance: Option<f32>,
    pub seed: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// The images of an edit, the one that is edited first. Empty: an image
    /// from text.
    pub images: Vec<PathBuf>,
    /// For an edit: the side of the square whose area every image is scaled
    /// to before the model sees it, and that the result has when no size is
    /// given. The same number Windows hands `TextEncodeQwenImage21`.
    pub resolution: Option<u32>,
    /// For an edit: the mask over the first image, white where the prompt
    /// paints and black where the image stays. Grey between the two is kept
    /// as a share: the engine mixes its result with the source by it, so a
    /// soft edge stays soft (`qwen_image_21_edit.py`, 0.22.0).
    pub mask: Option<PathBuf>,
    /// For an edit: how far the engine starts from noise, in (0, 1]. 1 or
    /// none: from noise alone, the engine's own default. Below that the run
    /// starts from the first image partway down the schedule.
    pub strength: Option<f32>,
    /// The LoRA stack of the run: files of the LoRA folder with the
    /// strengths the engine is handed, in the order they were picked. See
    /// `request_loras`.
    pub loras: Vec<(PathBuf, f32)>,
}

/// Every run passes `--low-ram`: the engine then caps its buffer cache at
/// 1 GB, decodes the image in tiles and drops the transformer the moment the
/// last step is through.
///
/// It used to be passed only below 2.5 times the size of the pack, so never
/// on the Mac it was built on. Measured there with Qwen-Image 2.1 4-bit at
/// 1024 x 1024 and 25 steps (M5 Pro, 48 GB, 09.10.2026):
///
///   plain                    126 s   36.1 GB footprint (17 to 19 GB in use,
///                                    the rest freed buffers MLX keeps)
///   `--mlx-cache-limit-gb 2`  91 s   17.1 GB (the image decoded in one piece)
///   `--low-ram`               95 s    8.4 GB, the same image
///
/// Without it the process grew until the Mac had nothing left, whatever the
/// Mac had, and beside other work that froze the machine. With it an edit at
/// 1024 peaks at 11.2 GB. Each run is a process of its own with one seed, so
/// the transformer it drops at the end would not have been used again.
const LOW_RAM: bool = true;

/// An edit never runs on a canvas of exactly 1024 x 1024.
///
/// On that one canvas Qwen-Image 2.1 does not edit: the picture comes back
/// with its subject unchanged and sharpened like an HDR filter. Real run,
/// 09.10.2026, "make the fox white" on a 1024 x 1024 source, 4-bit pack: the
/// fox turns white at 512, 768, 896, 960, 992, 1056 and 1152 x 896, with the
/// source scaled to 1024 or not, and stays red at 1024 x 1024 with the source
/// scaled to 1024 or to 896. The engine's own validation notes say the same
/// of the full precision model and of the reference implementation
/// (`mflux/models/qwen21/reference/VALIDATION.md`: "The 1024x1024 panda edits
/// did not pass visual acceptance"), so it is the model and not the pack.
///
/// 1024 is where Create starts, so the edit takes the next size on the grid.
const EDIT_DEAD_SIDE: u32 = 1024;
const EDIT_SIDE_INSTEAD: u32 = 1056;

/// The side an edit scales its images to, and with one image the side of the
/// result. Asked for 1024, a square source would land on the dead canvas.
fn edit_side(asked: u32) -> u32 {
    match fit_size(asked) {
        EDIT_DEAD_SIDE => EDIT_SIDE_INSTEAD,
        side => side,
    }
}

/// Width or height as the engine takes it. Qwen-Image 2.1 ends with an error
/// on a size that is not a multiple of 32, and the others want 16.
fn fit_size(pixels: u32) -> u32 {
    (pixels.clamp(256, 2048) / 32) * 32
}

/// Both sides of a canvas as the engine takes them. A side past the limit
/// shrinks the other one with it: clamped each by itself, a wide image came
/// back squeezed (Fehlerkontrolle Mac 3, Fund 16).
fn fit_canvas(width: u32, height: u32) -> (u32, u32) {
    const LIMIT: u32 = 2048;
    let longest = width.max(height);
    if longest <= LIMIT {
        return (fit_size(width), fit_size(height));
    }
    let scaled = |side: u32| (side as f64 * LIMIT as f64 / longest as f64).round() as u32;
    (fit_size(scaled(width)), fit_size(scaled(height)))
}

/// The steps a run takes: the adapter's own count where a LoRA fixes it,
/// otherwise what was asked for, otherwise the catalogue's.
fn steps_for(entry: &ImageCatalogEntry, pack: &Pack, asked: Option<u32>) -> u32 {
    match &pack.lora {
        Some(lora) => lora.steps,
        None => asked.unwrap_or(entry.steps).max(pack.family.min_steps()),
    }
}

/// The most guidance a run is given: where Create's slider ends.
const MAX_GUIDANCE: f32 = 30.0;

/// The guidance a run takes, `None` where the command gets no flag for it.
/// Qwen-Image 2.1 takes the user's, from 1 upwards: its command ends with an
/// error below 1, and Create's slider starts at 0. The other families that
/// take one run at the catalogue's.
fn guidance_for(entry: &ImageCatalogEntry, pack: &Pack, asked: Option<f32>) -> Option<f32> {
    if !pack.family.takes_guidance() {
        return None;
    }
    if !pack.user_sampling() {
        // The Turbo adapter is distilled without guidance: no flag, and the
        // command runs at its own 1.
        return (pack.family != Family::Qwen21).then_some(entry.guidance);
    }
    Some(asked.filter(|g| g.is_finite()).unwrap_or(entry.guidance).clamp(1.0, MAX_GUIDANCE))
}

/// The guidance a run really takes, for the entry in the gallery: the flag
/// where the command gets one, and otherwise what the command runs at by
/// itself. Never the slider of a model that does not read it.
fn guidance_taken(entry: &ImageCatalogEntry, pack: &Pack, asked: Option<f32>) -> f32 {
    guidance_for(entry, pack, asked).unwrap_or(pack.family.own_guidance())
}

/// Whether the negative prompt reaches the model at this guidance. At 1 the
/// Qwen-Image 2.1 command runs the positive pass alone and says that it
/// ignores the flag, the way a sampler at CFG 1 does on Windows.
fn negative_counts(pack: &Pack, guidance: Option<f32>) -> bool {
    match pack.family {
        Family::Qwen21 => guidance.is_some_and(|g| g > 1.0),
        family => family.takes_guidance(),
    }
}

/// Everything after the interpreter.
///
/// The prompt goes in as `--prompt=<text>`, in one argument: as two, a prompt
/// that begins with a dash is read as a flag. A prompt that is exactly one
/// dash means "read it from stdin" to the engine (`utils/prompt_util.py`),
/// and stdin is empty: it goes out with a space behind it, which the engine
/// takes as the text it is. The adapter stays unmerged
/// (`--no-bake-lora`): its card says that merging it into the weights loses
/// part of it, and here the weights are quantized on top. `--no-exif` keeps
/// the prompt out of the file, as the sidecar's images carry none either.
///
/// An edit hands over its images with `--image-paths`, the one that is edited
/// first, and `--output-resolution`. `size` is then given only where the
/// caller worked it out: without it the command takes the shape of the last
/// image, and Create's result follows the first.
#[allow(clippy::too_many_arguments)]
fn command_args(
    entry: &ImageCatalogEntry,
    pack: &Pack,
    model: &Path,
    lora: Option<&Path>,
    req: &Request,
    size: Option<(u32, u32)>,
    out: &Path,
    low_ram: bool,
) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec!["-m".into(), pack.family.module().into(), "--model".into(), model.into()];
    let mut push = |a: String| args.push(a.into());
    push("--base-model".into());
    push(pack.family.base_model().into());
    push(format!("--prompt={}", if req.prompt == "-" { "- " } else { req.prompt.as_str() }));
    push("--steps".into());
    push(steps_for(entry, pack, req.steps).to_string());
    if let Some((width, height)) = size {
        push("--width".into());
        push(width.to_string());
        push("--height".into());
        push(height.to_string());
    }
    if let Some(seed) = req.seed {
        push("--seed".into());
        push(seed.to_string());
    }
    let guidance = guidance_for(entry, pack, req.guidance);
    if let Some(guidance) = guidance {
        push("--guidance".into());
        push(guidance.to_string());
    }
    if negative_counts(pack, guidance) {
        if let Some(negative) = req.negative_prompt.as_deref().filter(|n| !n.trim().is_empty()) {
            push(format!("--negative-prompt={negative}"));
        }
    }
    if !req.images.is_empty() {
        // The flag takes every value up to the next flag, so it is followed
        // by one, and no value of it can begin with a dash: they are paths
        // this app wrote, all absolute.
        args.push("--image-paths".into());
        args.extend(req.images.iter().map(|p| p.as_os_str().to_os_string()));
        args.push("--output-resolution".into());
        args.push(edit_side(req.resolution.unwrap_or(entry.default_size)).to_string().into());
        if let Some(mask) = &req.mask {
            args.push("--mask-image".into());
            args.push(mask.into());
        }
        if let Some(strength) = req.strength.filter(|s| *s < 1.0) {
            args.push("--strength".into());
            args.push(strength.to_string().into());
        }
    }
    let adapter = pack.lora.as_ref().zip(lora);
    if let Some((adapter, file)) = adapter {
        args.push("--scheduler".into());
        args.push(adapter.scheduler.into());
        args.push("--lora".into());
        args.push(file.into());
        args.push("1.0".into());
    }
    // The user's stack, each file with its strength in a `--lora` of its
    // own, behind the pack's adapter, which stays. A path is absolute, so it
    // cannot be read as a flag, and a negative strength is read as the number
    // it is because it follows a path inside the same `--lora`.
    for (file, strength) in &req.loras {
        args.push("--lora".into());
        args.push(file.into());
        args.push(strength.to_string().into());
    }
    // One switch for all of them. Every pack here is quantized, and merged
    // into quantized weights a LoRA loses what is smaller than their step.
    if adapter.is_some() || !req.loras.is_empty() {
        args.push("--no-bake-lora".into());
    }
    if low_ram {
        args.push("--low-ram".into());
    }
    args.push("--no-exif".into());
    args.push("--output".into());
    args.push(out.into());
    args
}

/// The canvas of a run. An image from text has the size that was asked for,
/// or the catalogue's. An edit has one only where both sides were asked for.
fn canvas(entry: &ImageCatalogEntry, req: &Request) -> Option<(u32, u32)> {
    if req.images.is_empty() {
        return Some(fit_canvas(req.width.unwrap_or(entry.default_size), req.height.unwrap_or(entry.default_size)));
    }
    match fit_canvas(req.width?, req.height?) {
        (EDIT_DEAD_SIDE, EDIT_DEAD_SIDE) => Some((EDIT_SIDE_INSTEAD, EDIT_SIDE_INSTEAD)),
        size => Some(size),
    }
}

/// The folder Create stages an image in before a run reads it
/// (`video_stage_start_image`). An edit takes its images from there alone.
pub(super) fn staged_images_dir() -> PathBuf {
    crate::commands::video::outputs_root().join("start-images")
}

/// The images of an edit as the engine may read them, or the sentence for the
/// user. The paths come from the interface, so each has to be a file in
/// `staged`: the engine opens whatever it is handed.
fn edit_images(entry: &ImageCatalogEntry, pack: &Pack, asked: &[String], staged: &Path) -> Result<Vec<PathBuf>, String> {
    if asked.is_empty() {
        return Ok(Vec::new());
    }
    let most = pack.edit_images();
    if most == 0 {
        // Said, and not run without the image: that made an unrelated
        // picture out of the prompt and passed it off as the edit.
        return Err(format!("{} cannot edit an image. Pick Qwen-Image 2.1 for Edit.", entry.name));
    }
    if asked.len() > most {
        return Err(format!("{} takes at most {most} images in one edit.", entry.name));
    }
    staged_files(asked, staged)
}

/// The paths of `asked` as files inside `staged`, or the sentence for the
/// user. The paths come from the interface, and whatever reads them opens
/// whatever it is handed: a path that leads out of `staged` (through `..` or
/// a link) or to no file is refused.
pub(super) fn staged_files(asked: &[String], staged: &Path) -> Result<Vec<PathBuf>, String> {
    let gone = || "The image to edit is no longer on disk. Add it again.".to_string();
    let staged = staged.canonicalize().map_err(|_| gone())?;
    asked
        .iter()
        .map(|path| Path::new(path).canonicalize().ok().filter(|p| p.is_file() && p.starts_with(&staged)).ok_or_else(gone))
        .collect()
}

/// The mask of an edit as the engine may read it, or the sentence for the
/// user. Like the images it is a file Create staged, and it belongs to the
/// first of them: without an image there is nothing to paint over.
fn edit_mask(images: &[PathBuf], asked: Option<&str>, staged: &Path) -> Result<Option<PathBuf>, String> {
    let Some(asked) = asked else { return Ok(None) };
    if images.is_empty() {
        return Err("A mask needs the image it was painted on. Add the image again.".to_string());
    }
    let gone = || "The mask is no longer on disk. Paint it again.".to_string();
    let staged = staged.canonicalize().map_err(|_| gone())?;
    Path::new(asked).canonicalize().ok().filter(|p| p.is_file() && p.starts_with(&staged)).map(Some).ok_or_else(gone)
}

/// The lowest strength an edit is handed. The engine takes anything above 0,
/// but below this the source comes back nearly as it went in.
const MIN_EDIT_STRENGTH: f32 = 0.05;

/// The strength of an edit as the engine takes it: none for an image from
/// text and for 1 and above (the engine's default), else held to
/// `MIN_EDIT_STRENGTH`. A value that is no number is left out.
fn edit_strength(images: &[PathBuf], asked: Option<f32>) -> Option<f32> {
    let asked = asked.filter(|s| s.is_finite())?;
    (!images.is_empty() && asked < 1.0).then(|| asked.max(MIN_EDIT_STRENGTH))
}

/// The LoRA stack of a run as the engine may read it, or the sentence for the
/// user. A name is a path below `folder` and nothing else (`mlx_loras`).
///
/// What the engine would refuse only after it has loaded the model is
/// refused here, read from the header of the file: the engine matches key
/// names exactly, ends with an error on a file none of whose keys it knows,
/// and by then minutes have passed. Qwen-Image 2.1 reads `lora_A` / `lora_B`
/// keys alone (`qwen21_lora_mapping.py`: PEFT, `transformer.` and
/// `diffusion_model.`). The other families also read the Kohya naming, and
/// are left to judge a file themselves.
///
/// The same key table names no alpha, so the engine runs a Qwen-Image 2.1
/// LoRA at the strength it is handed and leaves out the `alpha / rank` the
/// file asks for (`lora_loader.py`, `_apply_lora_matrices_to_target`: the
/// share is applied only where an alpha key was matched). ComfyUI applies it.
/// For that family the strength therefore goes out times that share, read
/// from the file (`mlx_loras::read_alpha`). The other families name their
/// alpha keys and are handed the strength as it was asked for: scaled here
/// too, they would count it twice.
fn lora_files(entry: &ImageCatalogEntry, pack: &Pack, asked: &[(String, f32)], folder: &Path) -> Result<Vec<(PathBuf, f32)>, String> {
    use crate::commands::mlx_loras::{read_alpha, read_header, resolve, scaled, stem, strength, Alpha, Keys};
    asked
        .iter()
        .map(|(name, asked_strength)| {
            let file = resolve(folder, name)?;
            let header = read_header(&file);
            if header.keys == Keys::Unreadable {
                return Err(format!(
                    "{} is not a LoRA file the image engine can read. It may be an incomplete download.",
                    stem(name)
                ));
            }
            if header.keys == Keys::Peft && header.dora {
                return Err(format!("{} is a DoRA. The image engine of the Mac reads plain LoRAs only.", stem(name)));
            }
            if pack.family == Family::Qwen21 && header.keys != Keys::Peft {
                return Err(format!(
                    "{} is not in a format {} reads on a Mac. It takes LoRAs with lora_A and lora_B keys, the diffusers and ComfyUI format. Turn this LoRA off or pick another one.",
                    stem(name),
                    entry.name
                ));
            }
            let asked = strength(*asked_strength);
            let alpha = if pack.family == Family::Qwen21 { read_alpha(&file) } else { Alpha::None };
            if let Some(line) = alpha_said(stem(name), asked, alpha) {
                tracing::info!("[mflux] {line}");
            }
            Ok((file, scaled(asked, alpha)))
        })
        .collect()
}

/// The line the log gets for a LoRA whose alpha the app had to look at, so
/// a strength in the run's line that is not the one in Create explains
/// itself. Nothing for a file without an alpha.
fn alpha_said(name: &str, asked: f32, alpha: crate::commands::mlx_loras::Alpha) -> Option<String> {
    use crate::commands::mlx_loras::{scaled, Alpha};
    match alpha {
        Alpha::None => None,
        Alpha::Uniform(share) => Some(format!(
            "LoRA {name}: alpha / rank is {share}, strength {asked} goes to the engine as {}",
            scaled(asked, alpha)
        )),
        Alpha::Mixed => Some(format!(
            "LoRA {name}: alpha / rank differs from layer to layer, strength {asked} goes to the engine as it is"
        )),
    }
}

/// The strengths of the stack as the engine is handed them, for the run's
/// line in the log: " at 0.4, -4", and nothing without a stack.
fn strengths_said(loras: &[(PathBuf, f32)]) -> String {
    if loras.is_empty() {
        return String::new();
    }
    format!(" at {}", loras.iter().map(|(_, strength)| strength.to_string()).collect::<Vec<_>>().join(", "))
}

/// Width and height of a PNG, read from its header. An edit without a size
/// of its own takes the shape of its image, and the engine says what it made
/// in no other place than the file.
fn png_size(path: &Path) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut head = [0u8; 24];
    std::fs::File::open(path).ok()?.read_exact(&mut head).ok()?;
    if &head[..8] != b"\x89PNG\r\n\x1a\n" || &head[12..16] != b"IHDR" {
        return None;
    }
    let side = |at: usize| u32::from_be_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
    Some((side(16), side(20)))
}

/// The one generation this engine runs at a time: two would each load their
/// model into the one memory everything shares.
struct Runs {
    pid: std::sync::Mutex<Option<u32>>,
    /// The run from the moment it is accepted, which is before its process
    /// exists: the sidecar's model is unloaded first, and that can take
    /// seconds. Inside is the name the caller gave the run, if it gave one.
    held: std::sync::Mutex<Option<Option<String>>>,
    /// Set when the app ended the generation itself, so that its end is not
    /// reported as the system running out of memory. Set for a run that has
    /// no process yet as well: it then does not start one.
    stopped: std::sync::atomic::AtomicBool,
    /// The steps the run takes and the one it has finished, for the line
    /// under the image that is being made.
    steps: std::sync::atomic::AtomicU32,
    step: std::sync::atomic::AtomicU32,
}

impl Runs {
    const fn new() -> Self {
        Self {
            pid: std::sync::Mutex::new(None),
            held: std::sync::Mutex::new(None),
            stopped: std::sync::atomic::AtomicBool::new(false),
            steps: std::sync::atomic::AtomicU32::new(0),
            step: std::sync::atomic::AtomicU32::new(0),
        }
    }

    fn pid(&self) -> std::sync::MutexGuard<'_, Option<u32>> {
        self.pid.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn held(&self) -> std::sync::MutexGuard<'_, Option<Option<String>>> {
        self.held.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Take the one place for a run, before anything is done for it. `None`:
    /// another run has it. The place is given back when the claim is dropped.
    fn claim(&self, run: Option<String>) -> Option<Claim<'_>> {
        let mut held = self.held();
        if held.is_some() {
            return None;
        }
        self.stopped.store(false, std::sync::atomic::Ordering::SeqCst);
        *held = Some(run);
        Some(Claim(self))
    }

    /// A run was accepted or its process is up. Remove and the sidecar ask
    /// this, and the time before the process exists counts
    /// (Fehlerkontrolle Mac 3, Fund 6).
    fn busy(&self) -> bool {
        // One lock at a time: `stop` takes them in the other order.
        let held = self.held().is_some();
        held || self.pid().is_some()
    }

    /// End the run. `false`: there was none. A run without a process yet is
    /// marked, and `run` then starts none.
    fn stop(&self) -> bool {
        // Under the lock `run` holds from its look at the mark to the pid
        // it records: the stop is seen by one of the two.
        let pid = {
            let pid = self.pid();
            if pid.is_none() && self.held().is_none() {
                return false;
            }
            self.stopped.store(true, std::sync::atomic::Ordering::SeqCst);
            *pid
        };
        if let Some(pid) = pid {
            crate::process_util::kill_pid_tree(pid);
        }
        true
    }

    /// End the run that carries this name, and no other: a Cancel that is
    /// still being repeated for a run that is over must not end the next one
    /// (Fund 12). Without a name it ends whatever runs.
    fn stop_run(&self, run: Option<&str>) -> bool {
        if let Some(name) = run {
            if self.held().as_ref().and_then(|r| r.as_deref()) != Some(name) {
                return false;
            }
        }
        self.stop()
    }

    /// Read a line of the engine for the step it reports. Its bar counts the
    /// steps of the run; a bar with another total (the image decoded in
    /// tiles) is not one of them.
    fn note(&self, line: &str) {
        use std::sync::atomic::Ordering::SeqCst;
        if let Some((done, total)) = bar_progress(line) {
            if total == self.steps.load(SeqCst) {
                self.step.store(done.min(total), SeqCst);
            }
        }
    }

    /// Whether a run is under way, the step it has finished and how many it takes.
    fn progress(&self) -> (bool, u32, u32) {
        use std::sync::atomic::Ordering::SeqCst;
        let running = self.busy();
        if running {
            (true, self.step.load(SeqCst), self.steps.load(SeqCst))
        } else {
            (false, 0, 0)
        }
    }
}

/// The place of a run, held from the moment it is accepted. See `Runs::claim`.
pub(super) struct Claim<'a>(&'a Runs);

impl Drop for Claim<'_> {
    fn drop(&mut self) {
        *self.0.held() = None;
    }
}

/// `done/total` of a progress bar as tqdm writes it:
/// ` 50%|#####     | 20/40 [00:31<00:31,  1.57s/it]`.
fn bar_progress(line: &str) -> Option<(u32, u32)> {
    let counts = line.rsplit_once('|')?.1.trim_start();
    let (done, rest) = counts.split_once('/')?;
    let total = rest.split(|c: char| !c.is_ascii_digit()).next()?;
    Some((done.trim().parse().ok()?, total.parse().ok().filter(|t| *t > 0)?))
}

static RUNS: Runs = Runs::new();

/// Whether this engine is generating right now.
pub(super) fn busy() -> bool {
    RUNS.busy()
}

/// End the generation that is running. The quit path calls this: the child
/// holds many gigabytes and would outlive the app by minutes. Cancel in
/// Create calls it as well. `false`: nothing was running.
pub(super) fn stop() -> bool {
    RUNS.stop()
}

/// Cancel in Create: end the run with this name. See `Runs::stop_run`.
pub(super) fn stop_run(run: Option<&str>) -> bool {
    RUNS.stop_run(run)
}

/// Take the place for a run before the sidecar is asked to unload. `None`:
/// an image is being generated already.
pub(super) fn claim_run(run: Option<String>) -> Option<Claim<'static>> {
    RUNS.claim(run)
}

// ── A run that outlived the app ───────────────────────────────────────
//
// Fehlerkontrolle Mac 3, Fund 13. The quit path ends a running generation.
// After a crash or a Force Quit nothing does: macOS has no job object and no
// parent death signal, so the child goes on to the end of its image with the
// whole pack in memory, and without the hour's limit its parent kept. The
// next start ends it, the way `engine::reap_orphaned_sidecars` ends a chat
// server. A generation has no port and its program is a Python like any
// other, so the pid is written down while it runs, and that pid is only
// ended when it is still this: an mflux command on a pack in this app's own
// folder, with launchd as its parent. A pid the system has given to another
// program fails that, and so does the generation of a second running app.

/// Where the pid of the running generation is noted.
fn run_pid_file() -> PathBuf {
    crate::os_paths::data_dir().join("mlx").join("mflux-run.pid")
}

/// One process, reduced to what the rule below reads.
#[cfg(any(target_os = "macos", test))]
struct Leftover {
    parent: Option<u32>,
    cmd: Vec<String>,
}

/// Whether this is a generation of ours whose app is gone.
#[cfg(any(target_os = "macos", test))]
fn is_orphaned_run(row: &Leftover, models: &Path) -> bool {
    // The prompt enhancer takes the same place and is noted in the same
    // file: a script of ours handed over with `-c`, and not a module.
    let ours = |w: &[String]| {
        (w[0] == "-m" && w[1].starts_with("mflux.")) || (w[0] == "-c" && w[1].starts_with(super::enhancer::SCRIPT_MARK))
    };
    row.parent == Some(1)
        && row.cmd.windows(2).any(ours)
        && row.cmd.windows(2).any(|w| w[0] == "--model" && Path::new(&w[1]).starts_with(models))
}

/// End the generation the last session left behind, if there is one, and
/// return its pid. Called once at app start, off the main thread.
#[cfg(target_os = "macos")]
pub(super) fn reap_orphaned_run() -> Option<u32> {
    reap_orphaned_run_at(&run_pid_file(), &models_root())
}

// Gated like its callers: the start of the Mac app and the Mac test against
// real processes. With `test` in the gate the Windows and Linux test builds
// carried it unused, and `-D warnings` rejects that.
#[cfg(target_os = "macos")]
fn reap_orphaned_run_at(pid_file: &Path, models: &Path) -> Option<u32> {
    let pid: u32 = std::fs::read_to_string(pid_file).ok()?.trim().parse().ok()?;
    let table = crate::process_util::process_table_with_cmdlines();
    let Some(process) = table.process(sysinfo::Pid::from_u32(pid)) else {
        // It ended by itself. The note has done its work.
        let _ = std::fs::remove_file(pid_file);
        return None;
    };
    let row = Leftover { parent: process.parent().map(|p| p.as_u32()), cmd: crate::process_util::cmdline_of(process) };
    if !is_orphaned_run(&row, models) {
        // Somebody else's process under a reused pid, or the generation of
        // an app that is running: neither is touched. A note that names a
        // stranger is dropped, one that names a living run is its own.
        if row.parent == Some(1) {
            let _ = std::fs::remove_file(pid_file);
        }
        return None;
    }
    crate::process_util::kill_pid_tree(pid);
    let _ = std::fs::remove_file(pid_file);
    Some(pid)
}

/// What `mlx_generate_progress` answers: whether this engine is at an image,
/// and how far.
pub(super) fn progress() -> serde_json::Value {
    let (running, step, steps) = RUNS.progress();
    json!({ "running": running, "step": step, "steps": steps })
}

/// The images of an edit, checked. See `edit_images`.
pub(super) fn request_images(entry: &ImageCatalogEntry, pack: &Pack, asked: &[String]) -> Result<Vec<PathBuf>, String> {
    edit_images(entry, pack, asked, &staged_images_dir())
}

/// The mask of an edit, checked. See `edit_mask`.
pub(super) fn request_mask(images: &[PathBuf], asked: Option<&str>) -> Result<Option<PathBuf>, String> {
    edit_mask(images, asked, &staged_images_dir())
}

/// The strength of an edit as the engine takes it. See `edit_strength`.
pub(super) fn request_strength(images: &[PathBuf], asked: Option<f32>) -> Option<f32> {
    edit_strength(images, asked)
}

/// The LoRA stack of a run, checked. See `lora_files`.
pub(super) fn request_loras(entry: &ImageCatalogEntry, pack: &Pack, asked: &[(String, f32)]) -> Result<Vec<(PathBuf, f32)>, String> {
    if asked.is_empty() {
        return Ok(Vec::new());
    }
    lora_files(entry, pack, asked, &crate::commands::mlx_loras::loras_root())
}

pub(super) async fn generate(entry: &'static ImageCatalogEntry, pack: &'static Pack, req: Request) -> CmdResult {
    let root = models_root();
    let python = venv_python(&venv_dir());
    if !usable(entry.id, pack) {
        return Err(crate::commands::bad_request(format!(
            "{} is not installed. Install it in the Model Manager first.",
            entry.name
        )));
    }
    let out_dir = images_root();
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| crate::commands::internal(format!("mkdir {}: {}", out_dir.display(), os_error::english(&e))))?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let out = out_dir.join(format!("mlx-{stamp}-{}.png", std::process::id()));

    let model = pack_dir(&root, pack);
    let size = canvas(entry, &req);
    let steps = steps_for(entry, pack, req.steps);
    let guidance = guidance_taken(entry, pack, req.guidance);
    let low_ram = LOW_RAM;
    let lora = pack.lora.as_ref().map(|l| lora_dir(&root, l).join(l.file));
    let args = command_args(entry, pack, &model, lora.as_deref(), &req, size, &out, low_ram);

    let mut cmd = crate::python::python_command(&python);
    cmd.args(&args)
        // The pack is a folder on disk. Should it be incomplete, the engine
        // is to say so, and not start a download of thirty gigabytes of its
        // default in the middle of a generation.
        .env("HF_HUB_OFFLINE", "1")
        .env("HF_HOME", hf_home(&root))
        .env("MFLUX_CACHE_DIR", scratch(&root).join(".mflux-cache"))
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null());
    tracing::info!(
        "[mflux] python -m {} --model {} ({steps} steps, {}, {} image(s){}{}, {} LoRA(s){}{})",
        pack.family.module(),
        model.display(),
        size.map(|(w, h)| format!("{w}x{h}")).unwrap_or_else(|| "the size of the image".to_string()),
        req.images.len(),
        if req.mask.is_some() { ", masked" } else { "" },
        req.strength.filter(|s| *s < 1.0).map(|s| format!(", strength {s}")).unwrap_or_default(),
        req.loras.len(),
        strengths_said(&req.loras),
        if low_ram { ", low-ram" } else { "" }
    );

    let run_out = out.clone();
    tokio::task::spawn_blocking(move || run(&RUNS, cmd, &run_out, steps, Some(&run_pid_file())))
        .await
        .map_err(|e| crate::commands::internal(format!("The image engine did not report back ({e}).")))?
        .map_err(crate::commands::internal)?;

    use base64::Engine as _;
    let bytes = std::fs::read(&out).map_err(|e| crate::commands::internal(format!("read {}: {}", out.display(), os_error::english(&e))))?;
    // What the file is, and not what was asked for: an edit without a size
    // of its own comes back in the shape of its image.
    let (width, height) = png_size(&out).or(size).unwrap_or((entry.default_size, entry.default_size));
    Ok(json!({
        "image_base64": base64::engine::general_purpose::STANDARD.encode(bytes),
        "width": width,
        "height": height,
        "steps": steps,
        // What the run took, for the entry in the gallery: where the
        // command got no flag, the number it runs at by itself.
        "guidance": guidance,
        "output": out.to_string_lossy(),
    }))
}

// ── Enhance ───────────────────────────────────────────────────────────
//
// Enhance Image on a Mac: SeedVR2 through the engine's upscale command
// (`models/seedvr2/cli/seedvr2_upscale.py`, 0.22.0). Read from its source on
// 14.10.2026, not yet run here:
//
//   - `--image-path` takes files or folders; one staged file is handed over.
//   - `--resolution` is the shortest side of the result in pixels, or a
//     factor such as `2x`. A number is handed over, worked out here, so the
//     longest side can be held to `MAX_UPSCALE_SIDE`.
//   - `--model <folder>` with `seedvr2_ema_3b_fp16.safetensors` in it runs
//     the 3B model from that folder. A built-in name (`seedvr2`) would fetch
//     from the hub instead, and the folder would be dropped.
//   - One step, no prompt, no guidance. `--low-ram` is supported for a single
//     image (the README warns only for a folder), and the VAE is tiled by
//     default for this model (`TilingConfig` in `seedvr2_initializer.py`).
//   - `--output` goes through `str.format(seed=..., image_name=...)` before
//     the image is saved, so a brace in the path is doubled.

/// The factors Create offers, the ones the engine's own README shows.
pub(super) const UPSCALE_FACTORS: [u32; 2] = [2, 4];

/// The longest side a result may have. Not measured yet: no run of SeedVR2
/// has been made here. 4096 is 4K, and what a 1024 picture at 4x reaches.
/// To be checked against the peak memory of the first real run.
pub(super) const MAX_UPSCALE_SIDE: u32 = 4096;

/// The shortest side a picture needs to be enhanced. Below this the engine
/// would be handed a canvas of a few pixels.
const MIN_UPSCALE_SIDE: u32 = 32;

const UPSCALE_GONE: &str = "The image to enhance is no longer on disk. Add it again.";

/// The picture of an enhance as the engine may read it, or the sentence for
/// the user. The path comes from the interface, so it has to be a file in
/// `staged` (the same rule as `edit_images`).
fn upscale_input(asked: &str, staged: &Path) -> Result<PathBuf, String> {
    if asked.trim().is_empty() {
        return Err("Add an image to enhance.".to_string());
    }
    let staged = staged.canonicalize().map_err(|_| UPSCALE_GONE.to_string())?;
    Path::new(asked)
        .canonicalize()
        .ok()
        .filter(|p| p.is_file() && p.starts_with(&staged))
        .ok_or_else(|| UPSCALE_GONE.to_string())
}

/// What an enhance makes of a picture of `width` x `height` at `factor`:
/// the shortest side the engine is handed, and the size of the result as the
/// engine works it out (`SeedVR2Util.preprocess_image`: both sides scaled by
/// the same share, each rounded down to an even number). A factor that would
/// carry the longest side past `MAX_UPSCALE_SIDE` is lowered to reach it.
pub(super) fn upscale_target(width: u32, height: u32, factor: u32) -> Result<(u32, u32, u32), String> {
    if !UPSCALE_FACTORS.contains(&factor) {
        return Err(format!("Enhance enlarges by 2x or 4x, not {factor}x."));
    }
    let (short, long) = (width.min(height), width.max(height));
    if short < MIN_UPSCALE_SIDE {
        return Err(format!("The image is {width}x{height}. Enhance needs at least {MIN_UPSCALE_SIDE} pixels on each side."));
    }
    if long >= MAX_UPSCALE_SIDE {
        return Err(format!(
            "The image is {width}x{height} already. Enhance makes pictures up to {MAX_UPSCALE_SIDE} pixels on the longest side."
        ));
    }
    let share = (factor as f64).min(MAX_UPSCALE_SIDE as f64 / long as f64);
    let resolution = (short as f64 * share).floor() as u32;
    let scale = resolution as f64 / short as f64;
    let even = |side: u32| ((side as f64 * scale) as u32 / 2) * 2;
    Ok((resolution, even(width), even(height)))
}

/// A path as `--output` must carry it: the engine formats the string before
/// it saves, and a brace would be read as a field.
fn output_arg(out: &Path) -> std::ffi::OsString {
    out.to_string_lossy().replace('{', "{{").replace('}', "}}").into()
}

/// Everything after the interpreter, for an enhance.
fn upscale_args(pack: &Pack, model: &Path, input: &Path, resolution: u32, seed: Option<u64>, out: &Path, low_ram: bool) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = vec!["-m".into(), pack.family.module().into(), "--model".into(), model.into()];
    // The flag takes every value up to the next flag, and the path is one
    // this app wrote, absolute: it cannot be read as a flag.
    args.push("--image-path".into());
    args.push(input.into());
    args.push("--resolution".into());
    args.push(resolution.to_string().into());
    if let Some(seed) = seed {
        args.push("--seed".into());
        args.push(seed.to_string().into());
    }
    if low_ram {
        args.push("--low-ram".into());
    }
    args.push("--no-exif".into());
    args.push("--output".into());
    args.push(output_arg(out));
    args
}

/// The picture of an enhance, checked. See `upscale_input`.
pub(super) fn request_upscale_input(asked: &str) -> Result<PathBuf, String> {
    upscale_input(asked, &staged_images_dir())
}

/// Enhance the staged picture at `input` by `factor` with an upscaler pack.
/// Answers like `generate`: `image_base64`, `width`, `height`, `steps`,
/// `output`.
pub(super) async fn upscale(entry: &'static ImageCatalogEntry, pack: &'static Pack, input: PathBuf, factor: u32, seed: Option<u64>) -> CmdResult {
    if !pack.upscales() {
        return Err(crate::commands::bad_request(format!("{} makes pictures and does not enhance them.", entry.name)));
    }
    let root = models_root();
    let python = venv_python(&venv_dir());
    if !usable(entry.id, pack) {
        return Err(crate::commands::bad_request(format!(
            "{} is not installed. Install it in the Model Manager first.",
            entry.name
        )));
    }
    let (width, height) = image::image_dimensions(&input)
        .map_err(|e| crate::commands::bad_request(format!("The image could not be read ({e}). Use a PNG, JPG or WebP file.")))?;
    let (resolution, out_width, out_height) = upscale_target(width, height, factor).map_err(crate::commands::bad_request)?;
    let out_dir = images_root();
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| crate::commands::internal(format!("mkdir {}: {}", out_dir.display(), os_error::english(&e))))?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let out = out_dir.join(format!("enhance-{stamp}-{}.png", std::process::id()));

    let model = pack_dir(&root, pack);
    let args = upscale_args(pack, &model, &input, resolution, seed, &out, LOW_RAM);
    let mut cmd = crate::python::python_command(&python);
    cmd.args(&args)
        // The pack is a folder on disk. Should it be incomplete, the engine
        // is to say so, and not fetch its default from the hub.
        .env("HF_HUB_OFFLINE", "1")
        .env("HF_HOME", hf_home(&root))
        .env("MFLUX_CACHE_DIR", scratch(&root).join(".mflux-cache"))
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null());
    tracing::info!(
        "[mflux] python -m {} --model {} ({width}x{height} at {factor}x, to {out_width}x{out_height}{})",
        pack.family.module(),
        model.display(),
        if LOW_RAM { ", low-ram" } else { "" }
    );

    // One step: the engine's bar counts to 1.
    let steps = 1;
    let run_out = out.clone();
    tokio::task::spawn_blocking(move || run(&RUNS, cmd, &run_out, steps, Some(&run_pid_file())))
        .await
        .map_err(|e| crate::commands::internal(format!("The image engine did not report back ({e}).")))?
        .map_err(crate::commands::internal)?;

    use base64::Engine as _;
    let bytes = std::fs::read(&out).map_err(|e| crate::commands::internal(format!("read {}: {}", out.display(), os_error::english(&e))))?;
    let (width, height) = png_size(&out).unwrap_or((out_width, out_height));
    Ok(json!({
        "image_base64": base64::engine::general_purpose::STANDARD.encode(bytes),
        "width": width,
        "height": height,
        "steps": steps,
        "output": out.to_string_lossy(),
    }))
}

const STOPPED: &str = "The image was not finished because the app stopped the engine.";

/// Start the engine, wait for it and say how it ended. `steps` is what the
/// run takes, for reading its progress. The pid is noted in `pid_file` while
/// the process lives, for the start after a session that ended hard.
fn run(runs: &Runs, cmd: std::process::Command, out: &Path, steps: u32, pid_file: Option<&Path>) -> Result<(), String> {
    let ended = run_child(runs, cmd, steps, pid_file, GENERATE_TIMEOUT, None, "image engine")?;
    let verdict = match ended.status {
        Some(status) => outcome(&status, out.is_file(), &ended.said, &ended.warned, ended.stopped),
        None => Err("The image engine did not finish within an hour and was stopped.".to_string()),
    };
    if let Err(why) = &verdict {
        tracing::error!("[mflux] {why}");
        let _ = std::fs::remove_file(out);
    }
    verdict
}

/// How a process in the one place of `Runs` ended.
pub(super) struct Ended {
    /// `None`: it ran past its limit and was ended.
    pub status: Option<std::process::ExitStatus>,
    /// The last lines of its standard output and of its error stream.
    pub said: Vec<String>,
    pub warned: Vec<String>,
    /// The app ended it itself (Cancel, quit).
    pub stopped: bool,
}

/// Start `cmd` in the one place `runs` has for a process, hand it `input` on
/// its standard input when there is some, and wait for it. `engine` names it
/// in the sentence for a start that failed.
fn run_child(
    runs: &Runs,
    mut cmd: std::process::Command,
    steps: u32,
    pid_file: Option<&Path>,
    limit: std::time::Duration,
    input: Option<Vec<u8>>,
    engine: &str,
) -> Result<Ended, String> {
    use std::sync::atomic::Ordering::SeqCst;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = {
        let mut slot = runs.pid();
        if slot.is_some() {
            return Err("An image is already being generated on this Mac. Wait for it to finish.".to_string());
        }
        // Cancel came while the run had no process yet: it gets none.
        if runs.stopped.swap(false, SeqCst) {
            return Err(STOPPED.to_string());
        }
        let child = cmd.spawn().map_err(|e| format!("Could not start the {engine}: {}", os_error::english(&e)))?;
        if let Some(note) = pid_file {
            if let Some(dir) = note.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(note, child.id().to_string());
        }
        runs.step.store(0, SeqCst);
        runs.steps.store(steps, SeqCst);
        *slot = Some(child.id());
        child
    };
    let (stdin, stdout, stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (status, said, warned) = std::thread::scope(|scope| {
        if let (Some(mut stdin), Some(input)) = (stdin, input) {
            // Written beside the wait: a large request would otherwise fill
            // the pipe and hold both sides. Dropped at the end, which closes it.
            scope.spawn(move || {
                use std::io::Write;
                let _ = stdin.write_all(&input);
            });
        }
        let said = scope.spawn(move || tail_of(stdout, |_| {}));
        // The bar is drawn on the second stream.
        let warned = scope.spawn(move || tail_of(stderr, |line| runs.note(line)));
        let status = wait_with_timeout(&mut child, limit);
        *runs.pid() = None;
        if let Some(note) = pid_file {
            let _ = std::fs::remove_file(note);
        }
        (status, said.join().unwrap_or_default(), warned.join().unwrap_or_default())
    });
    let stopped = runs.stopped.swap(false, SeqCst);
    let status = status.map_err(|e| format!("wait failed: {}", os_error::english(&e)))?;
    Ok(Ended { status, said, warned, stopped })
}

/// `run_child` in the place image generations take, with the pid noted for
/// the start after a session that ended hard. Another engine's process (the
/// prompt enhancer) runs here so that it and an image never share the memory.
pub(super) fn run_in_place(
    cmd: std::process::Command,
    limit: std::time::Duration,
    input: Option<Vec<u8>>,
    engine: &str,
) -> Result<Ended, String> {
    run_child(&RUNS, cmd, 0, Some(&run_pid_file()), limit, input, engine)
}

/// `run_child` in a place of its own, with no pid noted anywhere: for the
/// enhancer's real run by hand, which must not touch the app's data folder
/// nor wait on an app that may be running beside it.
#[cfg(all(test, target_os = "macos"))]
pub(super) fn run_alone(
    cmd: std::process::Command,
    limit: std::time::Duration,
    input: Option<Vec<u8>>,
    engine: &str,
) -> Result<Ended, String> {
    run_child(&Runs::new(), cmd, 0, None, limit, input, engine)
}

/// `None` when the child had to be ended because it ran past `limit`.
fn wait_with_timeout(child: &mut std::process::Child, limit: std::time::Duration) -> std::io::Result<Option<std::process::ExitStatus>> {
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        if started.elapsed() > limit {
            let _ = crate::process_util::kill_tree(child);
            let _ = child.wait();
            return Ok(None);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

/// The last lines a stream carried, each handed to `seen` as it arrives. The
/// engine draws its progress bar by returning the carriage, so a line ends at
/// either.
fn tail_of<R: std::io::Read>(stream: Option<R>, seen: impl Fn(&str)) -> Vec<String> {
    let mut lines: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let Some(mut stream) = stream else {
        return Vec::new();
    };
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    let keep = |raw: &[u8], lines: &mut std::collections::VecDeque<String>| {
        let line = String::from_utf8_lossy(raw).trim().to_string();
        if !line.is_empty() {
            seen(&line);
            lines.push_back(line);
            if lines.len() > 40 {
                lines.pop_front();
            }
        }
    };
    while let Ok(read) = stream.read(&mut chunk) {
        if read == 0 {
            break;
        }
        for byte in &chunk[..read] {
            if *byte == b'\n' || *byte == b'\r' {
                keep(&pending, &mut lines);
                pending.clear();
            } else if pending.len() < 4096 {
                pending.push(*byte);
            }
        }
    }
    keep(&pending, &mut lines);
    lines.into()
}

/// The last line that says something: not a progress bar, and not a frame of
/// a traceback.
pub(super) fn last_word(lines: &[String]) -> Option<&str> {
    lines
        .iter()
        .rev()
        .map(String::as_str)
        .find(|l| !(l.contains("it/s]") || l.contains("s/it]") || l.starts_with("File \"") || l.starts_with('^') || l.starts_with("Peak MLX memory")))
}

/// The file the engine could apply nothing of, when that is why it stopped.
/// A LoRA of another model family passes every check before the load (it is
/// a safetensors file with LoRA matrices), and the engine then stops within
/// three seconds with a line about key endings and module paths, cut off at
/// 300 characters (real run, 09.10.2026).
fn foreign_lora(line: &str) -> Option<&str> {
    let rest = line.split_once("No LoRA layers were applied from ")?.1;
    let end = rest.find(".safetensors")? + ".safetensors".len();
    Some(&rest[..end])
}

/// How a generation ended, as `Ok` or the sentence for the user.
fn outcome(status: &std::process::ExitStatus, wrote_image: bool, said: &[String], warned: &[String], stopped: bool) -> Result<(), String> {
    if stopped {
        return Err(STOPPED.to_string());
    }
    if status.success() {
        if wrote_image {
            return Ok(());
        }
        // The engine prints why it stopped a run by itself (a battery that
        // is nearly empty) and ends with success.
        return Err(match last_word(said).or(last_word(warned)) {
            Some(line) => format!("The image engine finished without writing an image: {}", truncate(line, 300)),
            None => "The image engine finished without writing an image.".to_string(),
        });
    }
    if let Some(code) = status.code() {
        return Err(match last_word(warned).or(last_word(said)) {
            Some(line) if foreign_lora(line).is_some() => format!(
                "{} is not a LoRA for this model: none of its layers has a name this model knows. Take it off the stack, or pick one made for this model.",
                foreign_lora(line).unwrap_or_default()
            ),
            Some(line) => format!("The image engine stopped: {}", truncate(line, 300)),
            None => format!("The image engine stopped with exit code {code} and no message."),
        });
    }
    // No exit code means a signal, and nothing in this app sent one. On a Mac
    // that is the system taking the process away when memory runs out.
    Err("The image engine was ended by the system. This usually means the model did not fit into memory. Pick a smaller model or close other apps.".to_string())
}

/// For the tests of `commands::mlx`: the engine reads as installed, or not.
#[cfg(test)]
pub(super) fn set_ready_for_test(ready: bool) {
    let venv = venv_dir();
    assert!(venv.starts_with(crate::os_paths::test_storage::root()), "the test would write into the real app data");
    let _ = std::fs::remove_dir_all(&venv);
    if ready {
        std::fs::create_dir_all(venv.join("bin")).unwrap();
        std::fs::write(venv_python(&venv), b"").unwrap();
        std::fs::write(stamp_file(&venv), stamp()).unwrap();
    }
}

/// For `commands::real_run_mac`: the engine alone, on the slot and the thread
/// a model install brings it on. The app has no command for this, the engine
/// arrives with the first model. `false`: the slot is taken.
#[cfg(all(test, target_os = "macos"))]
pub(super) fn install_engine_alone(state: &AppState) -> bool {
    let slot = state.install_mlx_image_model();
    if !slot.try_start() {
        return false;
    }
    let preferred_base = state.python_bin();
    crate::install_state::spawn_install(slot, move |slot| {
        ensure_engine_at(slot, preferred_base, &venv_dir())?;
        Ok(format!("mflux {VERSION} installed"))
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mlx::IMAGE_CATALOG;
    use crate::commands::mlx_snapshot::RepoFile;


    fn entry(id: &str) -> &'static ImageCatalogEntry {
        IMAGE_CATALOG.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} is not in the catalogue"))
    }

    fn pack_of(id: &str) -> &'static Pack {
        entry(id).mflux.unwrap_or_else(|| panic!("{id} does not run on mflux"))
    }

    fn put(path: PathBuf, bytes: u64) {
        crate::test_support::sized_file(&path, bytes);
    }

    fn request(prompt: &str) -> Request {
        Request {
            prompt: prompt.to_string(),
            negative_prompt: None,
            steps: None,
            guidance: None,
            seed: None,
            width: None,
            height: None,
            images: Vec::new(),
            resolution: None,
            mask: None,
            strength: None,
            loras: Vec::new(),
        }
    }

    fn strings(args: &[std::ffi::OsString]) -> Vec<String> {
        args.iter().map(|a| a.to_string_lossy().to_string()).collect()
    }

    /// A pack on disk as an install leaves it, with the given entries on it.
    fn install_pack(root: &Path, pack: &Pack, ids: &[&str]) {
        let dir = pack_dir(root, pack);
        let files = vec![
            ManifestFile { path: "transformer/0.safetensors".into(), size: 7 },
            ManifestFile { path: "text_encoder/0.safetensors".into(), size: 5 },
            ManifestFile { path: "vae/0.safetensors".into(), size: 3 },
        ];
        for f in &files {
            put(dir.join(&f.path), f.size);
        }
        let manifest = Manifest { revision: pack.revision.to_string(), files };
        std::fs::write(dir.join(MANIFEST), serde_json::to_string(&manifest).unwrap()).unwrap();
        for id in ids {
            std::fs::write(claim(&dir, id), b"").unwrap();
        }
    }

    /// What ships: the file up to its first item that exists for tests alone.
    /// The helpers for the tests of other files stand between the last line
    /// of the engine and this module, and are no part of it.
    fn production() -> &'static str {
        let src = include_str!("image_mflux.rs");
        let end = src.find("#[cfg(test)]").unwrap();
        assert!(end <= src.find("#[cfg(test)]\nmod tests").unwrap());
        &src[..end]
    }

    #[test]
    fn the_engine_is_one_pinned_wheel_and_every_package_under_it_is_exact() {
        assert_eq!(PINNED[0], format!("mflux=={VERSION}"));
        for spec in PINNED {
            let (name, version) = spec.split_once("==").unwrap_or_else(|| panic!("{spec} is not pinned"));
            assert!(!name.is_empty() && version.chars().next().is_some_and(|c| c.is_ascii_digit()), "{spec}");
            assert!(!spec.contains(">=") && !spec.contains('<') && !spec.contains('~'), "{spec} is a range");
            assert!(!spec.contains("git+") && !spec.contains("://"), "{spec}: pip needs git for that, and a fresh Mac has none");
        }
        // What the engine refuses to import without, and what moved under it
        // between releases: MLX, torch and transformers.
        for name in ["mlx==0.32.", "torch==2.13.", "transformers==5.", "huggingface-hub==", "numpy==", "pillow=="] {
            assert!(PINNED.iter().any(|s| s.starts_with(name)), "{name} is not in the install");
        }
        assert!(!production().contains("@main") && !production().contains("@master"));
    }

    /// On a Mac the cache folder is emptied by the system and by cleaning
    /// tools. The packs are not in it, what a download leaves behind is.
    #[test]
    fn the_packs_are_out_of_the_cache_folder_on_a_mac_and_the_scratch_is_in_it() {
        let root = models_root();
        let cache = crate::media_store::scratch_root(crate::media_store::Store::Mflux);
        assert_eq!(hf_home(&root), cache.join(".hf-cache"));
        assert_eq!(scratch(&root), cache);
        if cfg!(target_os = "macos") {
            assert_eq!(root, crate::os_paths::data_dir().join("mlx").join("mflux"));
            assert_eq!(root.parent(), venv_dir().parent(), "beside the engine");
            assert!(!hf_home(&root).starts_with(&root));
        } else {
            // Windows and Linux: where they always were, scratch inside.
            assert_eq!(root, cache);
            assert_eq!(hf_home(&root), root.join(".hf-cache"));
        }
        // A folder that is not the app's keeps its scratch to itself.
        let other = crate::os_paths::test_dir("mflux-scratch");
        assert_eq!(hf_home(&other), other.join(".hf-cache"));
        // Both generate and install hand the engine the scratch, not the packs.
        assert!(production().contains(".env(\"MFLUX_CACHE_DIR\", scratch(&root).join(\".mflux-cache\"))"));
        assert!(!production().contains("root.join(\".hf-cache\")") && !production().contains("root.join(\".mflux-cache\")"));
    }

    #[test]
    fn it_has_a_venv_of_its_own_beside_the_sidecars() {
        let venv = venv_dir();
        let sidecar = crate::os_paths::data_dir().join("mlx").join("venv");
        assert!(venv.starts_with(crate::os_paths::data_dir()));
        assert_eq!(venv.parent(), sidecar.parent(), "beside the sidecar's venv");
        assert_ne!(venv, sidecar, "torch 2.13 in the sidecar's venv breaks its pinned torch 2.12.1");
        assert_ne!(venv, crate::os_paths::data_dir().join("mlx-video").join("venv"));
        // The engine never runs in another environment, and never starts the sidecar.
        assert!(!production().contains("super::venv_python") && !production().contains("mlx_root"));
        assert!(!production().contains("server.py") && !production().contains("MLX_PORT"));
    }

    #[test]
    fn a_venv_without_the_stamp_of_this_pin_is_not_the_engine() {
        let root = tempfile::tempdir().unwrap();
        let venv = root.path().join("venv-mflux");
        assert!(!ready_at(&venv));
        put(venv_python(&venv), 1);
        assert!(!ready_at(&venv), "an install that was stopped has no stamp");
        std::fs::write(stamp_file(&venv), "mflux==0.21.0\nmlx==0.32.0").unwrap();
        assert!(!ready_at(&venv), "the stamp of another pin");
        std::fs::write(stamp_file(&venv), stamp()).unwrap();
        assert!(ready_at(&venv));
    }

    /// The whole install against a stand-in interpreter: a shell script that
    /// builds a "venv" whose `python` answers the questions the install asks
    /// and writes down what pip was called with.
    #[cfg(unix)]
    #[test]
    fn the_install_builds_the_venv_and_runs_one_pip_call_with_every_pin() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let pip_log = root.path().join("pip-args.txt");
        let venv_py = format!(
            "#!/bin/sh\ncase \"$1 $2\" in\n  '-c import pip') exit 0 ;;\n  '-c import {MODULE}') [ -f '{log}' ] ; exit $? ;;\n  '-m pip') shift 2 ; printf '%s\\n' \"$@\" > '{log}' ;;\n  *) exit 4 ;;\nesac\n",
            log = pip_log.display(),
        );
        let base = root.path().join("python3.12");
        std::fs::write(
            &base,
            format!(
                "#!/bin/sh\nif [ \"$1\" = -c ]; then echo '3 12'; exit 0; fi\n[ \"$1\" = -m ] && [ \"$2\" = venv ] || exit 3\nmkdir -p \"$4/bin\"\ncat > \"$4/bin/python\" <<'LU_EOF'\n{venv_py}LU_EOF\nchmod +x \"$4/bin/python\"\n"
            ),
        )
        .unwrap();
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o755)).unwrap();

        let slot = InstallSlot::default();
        let venv = root.path().join("mlx").join("venv-mflux");
        let python = ensure_engine_at(&slot, Some(base.to_string_lossy().to_string()), &venv).unwrap();
        assert_eq!(PathBuf::from(&python), venv_python(&venv));

        let mut expected = vec!["install".to_string(), "--upgrade".to_string()];
        expected.extend(PINNED.iter().map(|p| p.to_string()));
        let called: Vec<String> = std::fs::read_to_string(&pip_log).unwrap().lines().map(String::from).collect();
        assert_eq!(called, expected, "one pip call with the wheel and every pin");
        assert!(ready_at(&venv));

        // A second model of this engine finds it and installs nothing.
        std::fs::remove_file(&pip_log).unwrap();
        ensure_engine_at(&slot, None, &venv).unwrap();
        assert!(!pip_log.exists(), "pip ran again for an engine that is there");
    }

    #[test]
    fn every_mflux_entry_names_a_pinned_pack_and_says_it_is_untested() {
        let entries: Vec<&ImageCatalogEntry> = IMAGE_CATALOG.iter().filter(|c| c.mflux.is_some()).collect();
        let ids: Vec<&str> = entries.iter().map(|c| c.id).collect();
        assert_eq!(
            ids,
            [
                "flux2-klein-4b-4bit",
                "z-image-turbo-4bit",
                "qwen-image-2.1-4bit",
                "z-image-turbo-8bit",
                "qwen-image-2.1-8bit",
                "qwen-image-2.1-turbo",
                "qwen-image-2512-8bit",
                "seedvr2-3b",
            ]
        );
        for c in &entries {
            let pack = c.mflux.unwrap();
            assert_eq!(pack.revision.len(), 40, "{}: a full commit id, not a branch", c.id);
            assert!(pack.revision.chars().all(|ch| ch.is_ascii_hexdigit()), "{}", c.id);
            assert!(!pack.dir.contains('/') && !pack.dir.starts_with('.') && !pack.dir.starts_with('_'), "{}", c.id);
            // The three Qwen-Image 2.1 entries have run here (real runs,
            // 09.10.2026: text to image and edit on each pack, Turbo with
            // its adapter and with a LoRA on top), and so have Z-Image Turbo
            // 4-bit (with a LoRA, and as the base of a training) and SeedVR2
            // 3B (2x and 4x) on 14 and 15.10.2026.
            let ran = ["qwen-image-2.1-4bit", "qwen-image-2.1-8bit", "qwen-image-2.1-turbo", "z-image-turbo-4bit", "seedvr2-3b"];
            assert_eq!(c.description.ends_with("Experimental: not yet tested in LU."), !ran.contains(&c.id), "{}", c.id);
            assert!(!c.retired && !c.unfiltered, "{}", c.id);
            assert_eq!(c.default_size % 32, 0, "{}", c.id);
            // The Qwen-Image 2.1 weights are under a research licence, and
            // the tile says so.
            assert_eq!(pack.family == Family::Qwen21, c.description.contains("non-commercial"), "{}", c.id);
        }
        // The task's own floor: an 8-bit and a 4-bit Qwen-Image 2.1, the
        // smaller one for the smaller Mac.
        assert!(entry("qwen-image-2.1-4bit").min_ram_gb < entry("qwen-image-2.1-8bit").min_ram_gb);
        assert!(entry("qwen-image-2.1-4bit").size_gb < entry("qwen-image-2.1-8bit").size_gb);
        // The diffusers entry of the 20B model stays, for the Macs that hold it whole.
        assert!(entry("qwen-image-2512").mflux.is_none());
        assert_eq!(entry("qwen-image-2512").min_ram_gb, 64);
    }

    #[test]
    fn the_turbo_entry_runs_on_the_eight_bit_pack_with_its_adapter() {
        let turbo = pack_of("qwen-image-2.1-turbo");
        let plain = pack_of("qwen-image-2.1-8bit");
        assert_eq!((turbo.dir, turbo.revision), (plain.dir, plain.revision), "one download for both");
        assert_eq!(entry("qwen-image-2.1-turbo").repo, entry("qwen-image-2.1-8bit").repo);
        let lora = turbo.lora.as_ref().unwrap();
        assert_eq!((lora.scheduler, lora.steps), ("viggle_turbo", 6), "the adapter's schedule has six nodes");
        assert_eq!(entry("qwen-image-2.1-turbo").steps, 6);
        assert!(super::super::is_repo_id(lora.repo) && lora.revision.len() == 40 && lora.file.ends_with(".safetensors"));
        // The catalogue's size is the pack and the adapter together.
        let both = entry("qwen-image-2.1-8bit").size_gb as f64 + lora.bytes as f64 / 1e9;
        assert!((entry("qwen-image-2.1-turbo").size_gb as f64 - both).abs() < 0.06, "{both}");
        assert!(plain.lora.is_none());
    }

    #[test]
    fn the_plan_takes_what_the_command_reads_and_leaves_the_rest_on_the_hub() {
        let file = |path: &str, size: u64| RepoFile { path: path.to_string(), size, sha256: None };
        let listing = vec![
            file("README.md", 2959),
            file("LICENSE", 7831),
            file("osaurus-x-banner.png", 26319),
            file("model_index.json", 447),
            file("processor/tokenizer.json", 11),
            file("scheduler/scheduler_config.json", 485),
            file("text_encoder/0.safetensors", 100),
            file("text_encoder/config.json", 1),
            file("transformer/0.safetensors", 200),
            file("vae/0.safetensors", 300),
            file("vae/config.json", 2),
        ];
        let planned = plan(Family::Qwen21, &listing).unwrap();
        let paths: Vec<&str> = planned.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            ["model_index.json", "processor/tokenizer.json", "scheduler/scheduler_config.json", "text_encoder/0.safetensors", "text_encoder/config.json", "transformer/0.safetensors", "vae/0.safetensors", "vae/config.json"]
        );
        // The other commands read a tokenizer folder and no model index.
        let z = plan(Family::ZImageTurbo, &[file("tokenizer/tokenizer.json", 1), file("model_index.json", 1), file("text_encoder/0.safetensors", 1), file("transformer/0.safetensors", 1), file("vae/0.safetensors", 1)]).unwrap();
        assert_eq!(z.files.len(), 4);
        // A repository whose upload is not through is not a pack.
        let half: Vec<RepoFile> = listing.iter().filter(|f| !f.path.starts_with("vae/")).cloned().collect();
        assert_eq!(plan(Family::Qwen21, &half).unwrap_err(), "The repository has no weights under vae/ and cannot be run. Try again later.");
    }

    #[test]
    fn a_pack_is_installed_with_every_file_its_claim_and_the_engine() {
        let root = tempfile::tempdir().unwrap();
        let pack = pack_of("qwen-image-2.1-8bit");
        let dir = pack_dir(root.path(), pack);
        assert!(!installed_at(root.path(), "qwen-image-2.1-8bit", pack));
        // A download that was stopped: files, and no manifest.
        put(dir.join("transformer/0.safetensors"), 7);
        assert!(!pack_complete(&dir) && pack_bytes(&dir) == 0);
        install_pack(root.path(), pack, &["qwen-image-2.1-8bit"]);
        assert!(installed_at(root.path(), "qwen-image-2.1-8bit", pack));
        assert_eq!(pack_bytes(&dir), 15);
        // A file that lost bytes is not the file.
        put(dir.join("vae/0.safetensors"), 2);
        assert!(!installed_at(root.path(), "qwen-image-2.1-8bit", pack));
        put(dir.join("vae/0.safetensors"), 3);
        assert!(installed_at(root.path(), "qwen-image-2.1-8bit", pack));
        // The turbo entry has every weight file here and is still not
        // installed: nobody asked for it, and its adapter is not there.
        let turbo = pack_of("qwen-image-2.1-turbo");
        assert!(!installed_at(root.path(), "qwen-image-2.1-turbo", turbo));
        std::fs::write(claim(&dir, "qwen-image-2.1-turbo"), b"").unwrap();
        assert!(!installed_at(root.path(), "qwen-image-2.1-turbo", turbo), "the adapter is missing");
        let lora = turbo.lora.as_ref().unwrap();
        put(lora_dir(root.path(), lora).join(lora.file), lora.bytes - 1);
        assert!(!installed_at(root.path(), "qwen-image-2.1-turbo", turbo), "an adapter that was cut short");
        put(lora_dir(root.path(), lora).join(lora.file), lora.bytes);
        assert!(installed_at(root.path(), "qwen-image-2.1-turbo", turbo));
    }

    #[test]
    fn a_model_without_its_engine_reads_as_not_installed() {
        let pack = pack_of("z-image-turbo-4bit");
        install_pack(&models_root(), pack, &["z-image-turbo-4bit"]);
        set_ready_for_test(false);
        assert!(!usable("z-image-turbo-4bit", pack), "Get has to bring the engine back");
        set_ready_for_test(true);
        assert!(usable("z-image-turbo-4bit", pack));
        set_ready_for_test(false);
        let _ = std::fs::remove_dir_all(pack_dir(&models_root(), pack));
    }

    #[test]
    fn remove_takes_the_pack_with_the_last_entry_that_uses_it() {
        let root = tempfile::tempdir().unwrap();
        let plain = pack_of("qwen-image-2.1-8bit");
        let turbo = pack_of("qwen-image-2.1-turbo");
        let dir = pack_dir(root.path(), plain);
        let lora = turbo.lora.as_ref().unwrap();
        assert_eq!(delete_at(root.path(), "qwen-image-2.1-8bit", plain), Err(DeleteError::NotInstalled));
        install_pack(root.path(), plain, &["qwen-image-2.1-8bit", "qwen-image-2.1-turbo"]);
        put(lora_dir(root.path(), lora).join(lora.file), lora.bytes);
        put(hf_home(root.path()).join("xet").join("chunk"), 9);

        // The plain entry goes, and the files stay for the turbo entry.
        delete_at(root.path(), "qwen-image-2.1-8bit", plain).unwrap();
        assert!(!installed_at(root.path(), "qwen-image-2.1-8bit", plain));
        assert!(installed_at(root.path(), "qwen-image-2.1-turbo", turbo), "eighteen gigabytes another entry runs on");
        assert!(!hf_home(root.path()).join("xet").exists(), "the chunk cache stayed behind");
        assert_eq!(delete_at(root.path(), "qwen-image-2.1-8bit", plain), Err(DeleteError::NotInstalled), "it has nothing here any more");
        // The last entry takes the pack and its adapter.
        delete_at(root.path(), "qwen-image-2.1-turbo", turbo).unwrap();
        assert!(!dir.exists() && !lora_dir(root.path(), lora).exists());

        // A download that was stopped has no claim, and Remove clears it.
        put(dir.join("transformer/0.safetensors"), 7);
        delete_at(root.path(), "qwen-image-2.1-8bit", plain).unwrap();
        assert!(!dir.exists());
    }

    /// Real install of Turbo, 09.10.2026: the bar stood at its end for the
    /// ten minutes in which the adapter came in.
    #[test]
    fn the_bar_of_an_install_counts_the_lora_that_is_still_to_come() {
        let src = include_str!("image_mflux.rs");
        let steps = &src[src.find("fn install_steps(").unwrap()..src.find("fn hub_snapshot(").unwrap()];
        // With the pack: its folder, and beside it the chunk cache and the folder of the adapter.
        assert!(steps.contains("std::iter::once(hf_home(root).join(\"xet\")).chain(adapter.map(|l| lora_dir(root, l)))"));
        assert!(steps.contains("watch_dir_size(slot.clone(), dir.clone(), beside, total + adapter_bytes)"));
        // On a pack that is there: the adapter alone, and not no bar at all.
        assert!(steps.contains("watch_dir_size(slot.clone(), lora_dir(root, lora), vec![hf_home(root).join(\"xet\")], adapter_bytes)"));
        // Only an adapter that is not there yet counts.
        assert!(steps.contains("pack.lora.as_ref().filter(|l| !lora_present(root, l))"));
        // A finished step leaves no half written piece behind.
        let snapshot = &src[src.find("fn hub_snapshot(").unwrap()..src.find("fn hub_file(").unwrap()];
        assert!(snapshot.find("run_hub_step(slot, &mut cmd, &[target, &hf_home(root)])?;").unwrap() < snapshot.rfind("super::drop_stale_partials(target);").unwrap());
    }

    #[test]
    fn an_install_only_needs_room_for_what_is_not_there() {
        let root = tempfile::tempdir().unwrap();
        let plain = pack_of("qwen-image-2.1-8bit");
        let turbo = pack_of("qwen-image-2.1-turbo");
        let lora = turbo.lora.as_ref().unwrap().bytes;
        let size = |id: &str| (entry(id).size_gb as f64 * 1e9) as u64;
        // A fresh Mac: the pack and the engine.
        assert_eq!(bytes_to_fetch(root.path(), size("qwen-image-2.1-8bit"), plain, false), size("qwen-image-2.1-8bit") + ENGINE_INSTALL_BYTES);
        assert_eq!(bytes_to_fetch(root.path(), size("qwen-image-2.1-8bit"), plain, true), size("qwen-image-2.1-8bit"));
        // What a stopped download fetched is not asked for again.
        put(pack_dir(root.path(), plain).join("transformer/0.safetensors"), 4_000_000_000);
        assert_eq!(bytes_to_fetch(root.path(), size("qwen-image-2.1-8bit"), plain, true), size("qwen-image-2.1-8bit") - 4_000_000_000);
        // With the 8-bit pack there, the turbo entry fetches its adapter only.
        install_pack(root.path(), plain, &["qwen-image-2.1-8bit"]);
        assert_eq!(bytes_to_fetch(root.path(), size("qwen-image-2.1-turbo"), turbo, true), lora);
        assert_eq!(bytes_to_fetch(root.path(), size("qwen-image-2.1-8bit"), plain, true), 0);
    }

    #[test]
    fn every_run_caps_the_memory_of_the_engine() {
        // Real run, 09.10.2026: without the flag a 4-bit run took 36 GB of a
        // 48 GB Mac and froze it beside other work. No size of Mac and no
        // size of pack switches it off again.
        const { assert!(LOW_RAM) };
        let generate = &production()[production().find("pub(super) async fn generate").unwrap()..];
        assert!(generate.contains("let low_ram = LOW_RAM;"));
        assert!(!production().contains("total_memory_bytes"), "the flag depends on the size of the Mac again");
    }

    #[test]
    fn an_edit_stays_off_the_one_canvas_the_model_does_not_edit_on() {
        let (e, pack) = (entry("qwen-image-2.1-4bit"), pack_of("qwen-image-2.1-4bit"));
        let (model, out) = (Path::new("/m/pack"), Path::new("/o/x.png"));
        // One image, Create's 1024: the engine sizes the result itself from
        // this number, and a square source would come out at 1024 x 1024.
        let mut req = request("make the fox white");
        req.images = vec![PathBuf::from("/v/start-images/a.png")];
        req.resolution = Some(1024);
        let args = strings(&command_args(e, pack, model, None, &req, canvas(e, &req), out, true));
        assert!(args.windows(2).any(|w| w == ["--output-resolution", "1056"]), "{args:?}");
        // Nothing asked for is the catalogue's 1024, and goes the same way.
        req.resolution = None;
        let args = strings(&command_args(e, pack, model, None, &req, canvas(e, &req), out, true));
        assert!(args.windows(2).any(|w| w == ["--output-resolution", "1056"]), "{args:?}");
        // Every other budget is the one that was asked for.
        for side in [512, 768, 896, 992, 1056, 1536] {
            assert_eq!(edit_side(side), side);
        }
        // Several images: the canvas comes from Create, and the square one moves.
        req.images.push(PathBuf::from("/v/start-images/b.png"));
        (req.width, req.height) = (Some(1024), Some(1024));
        assert_eq!(canvas(e, &req), Some((1056, 1056)));
        (req.width, req.height) = (Some(1152), Some(896));
        assert_eq!(canvas(e, &req), Some((1152, 896)));
        (req.width, req.height) = (Some(1024), Some(768));
        assert_eq!(canvas(e, &req), Some((1024, 768)), "only the square is known to be dead");
        // An image from text is not an edit and keeps its 1024.
        let plain = request("a fox");
        assert_eq!(canvas(e, &plain), Some((1024, 1024)));
    }

    #[test]
    fn sizes_land_on_the_grid_the_engine_takes() {
        for (asked, given) in [(1024, 1024), (1000, 992), (832, 832), (1216, 1216), (768, 768), (100, 256), (4096, 2048), (1023, 992), (0, 256)] {
            assert_eq!(fit_size(asked), given, "{asked}");
            assert_eq!(fit_size(asked) % 32, 0);
        }
    }

    /// Fehlerkontrolle Mac 3, Fund 11: the engine reads a prompt that is
    /// exactly a dash from stdin, which is empty, and ends with an error.
    #[test]
    fn a_prompt_that_is_one_dash_is_not_read_as_stdin() {
        let e = entry("qwen-image-2.1-8bit");
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/m"), None, &request("-"), Some((1024, 1024)), Path::new("/o.png"), false));
        assert!(!args.contains(&"--prompt=-".to_string()), "{args:?}");
        assert!(args.contains(&"--prompt=- ".to_string()), "the dash still reaches the model: {args:?}");
        // Every other prompt goes out as it was typed.
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/m"), None, &request("-a"), Some((1024, 1024)), Path::new("/o.png"), false));
        assert!(args.contains(&"--prompt=-a".to_string()));
    }

    /// Fund 16: a canvas with a side past the engine's limit keeps its shape.
    #[test]
    fn a_canvas_past_the_limit_is_scaled_and_not_squeezed() {
        let e = entry("qwen-image-2.1-8bit");
        let mut edit = request("a cat");
        edit.images = vec![PathBuf::from("/v/start-images/a.png")];
        // 3:1 at a budget of 2048 squared, as Create works it out.
        (edit.width, edit.height) = (Some(3552), Some(1184));
        let (width, height) = canvas(e, &edit).unwrap();
        assert!(width <= 2048 && height <= 2048 && width % 32 == 0 && height % 32 == 0, "{width}x{height}");
        let ratio = width as f64 / height as f64;
        assert!((ratio - 3.0).abs() < 0.15, "the shape is lost: {width}x{height}");
        // Inside the limit nothing changes.
        (edit.width, edit.height) = (Some(1536), Some(512));
        assert_eq!(canvas(e, &edit), Some((1536, 512)));
        let mut plain = request("a cat");
        (plain.width, plain.height) = (Some(1000), Some(1024));
        assert_eq!(canvas(e, &plain), Some((992, 1024)));
    }

    #[test]
    fn the_command_line_is_the_one_the_engine_reads() {
        let model = Path::new("/c/lu labs/mflux/qwen-image-2.1-8bit");
        let out = Path::new("/i/mlx-1-2.png");
        let e = entry("qwen-image-2.1-8bit");
        let mut req = request("a red panda");
        req.seed = Some(42);
        let args = strings(&command_args(e, pack_of(e.id), model, None, &req, Some((1024, 1024)), out, false));
        assert_eq!(
            args,
            [
                "-m",
                "mflux.models.qwen21.cli.qwen21_edit_generate",
                "--model",
                "/c/lu labs/mflux/qwen-image-2.1-8bit",
                "--base-model",
                "qwen-image-2.1",
                "--prompt=a red panda",
                "--steps",
                "25",
                "--width",
                "1024",
                "--height",
                "1024",
                "--seed",
                "42",
                "--guidance",
                "1",
                "--no-exif",
                "--output",
                "/i/mlx-1-2.png",
            ]
        );
        // An image from text hands the engine none of the edit's flags. The
        // engine's own mask finder and the init image of text to image are
        // not used: the mask is the one painted in Create.
        assert!(!args.iter().any(|a| a == "--image-paths" || a == "--output-resolution" || a == "--mask-image" || a == "--strength"));
        // `--image-path` belongs to the upscaler alone (`upscale_args`): the
        // picture commands never get it.
        let picture = &production()[production().find("fn command_args(").unwrap()..];
        let picture = &picture[..picture.find("\n}\n").unwrap()];
        for flag in ["--image", "--image-path", "--auto-mask"] {
            assert!(!picture.contains(&format!("\"{flag}\"")), "{flag}");
        }
        for flag in ["--image", "--auto-mask"] {
            assert!(!production().contains(&format!("\"{flag}\"")), "{flag}");
        }

        // A prompt that begins with a dash stays the prompt, and a smaller
        // Mac gets the flag. Steps the caller asked for are kept.
        let mut req = request("--low-ram and a cat");
        req.steps = Some(40);
        req.negative_prompt = Some("blurry".into());
        let args = strings(&command_args(e, pack_of(e.id), model, None, &req, Some((832, 1216)), out, true));
        assert!(args.contains(&"--prompt=--low-ram and a cat".to_string()));
        assert_eq!(args.iter().filter(|a| *a == "--low-ram").count(), 1);
        assert!(args.windows(2).any(|w| w == ["--steps", "40"]) && args.windows(2).any(|w| w == ["--width", "832"]));
        // At guidance 1 the engine runs the positive pass alone and would
        // only say that it ignores the negative prompt.
        assert!(args.windows(2).any(|w| w == ["--guidance", "1"]));
        assert!(!args.iter().any(|a| a.starts_with("--negative-prompt")), "{args:?}");
        assert!(!args.iter().any(|a| a == "--seed"), "no seed asked, the engine picks one");
    }

    #[test]
    fn the_guidance_of_qwen_image_21_is_the_users_from_one_upwards() {
        let e = entry("qwen-image-2.1-8bit");
        let pack = pack_of(e.id);
        assert_eq!(guidance_for(e, pack, None), Some(1.0), "the catalogue's, which is the model's own");
        assert_eq!(guidance_for(e, pack, Some(4.0)), Some(4.0));
        assert_eq!(guidance_for(e, pack, Some(2.5)), Some(2.5));
        // Create's slider starts at 0 and the engine ends with an error below 1.
        assert_eq!(guidance_for(e, pack, Some(0.0)), Some(1.0));
        assert_eq!(guidance_for(e, pack, Some(0.5)), Some(1.0));
        assert_eq!(guidance_for(e, pack, Some(99.0)), Some(30.0));
        assert_eq!(guidance_for(e, pack, Some(f32::NAN)), Some(1.0));
        assert_eq!(guidance_for(e, pack, Some(f32::INFINITY)), Some(1.0));

        // Above 1 the negative prompt goes out, in one argument like the prompt.
        let mut req = request("a cat");
        req.guidance = Some(4.0);
        req.negative_prompt = Some("-blurry, low quality".into());
        let args = strings(&command_args(e, pack, Path::new("/m"), None, &req, Some((1024, 1024)), Path::new("/o.png"), false));
        assert!(args.windows(2).any(|w| w == ["--guidance", "4"]), "{args:?}");
        assert!(args.contains(&"--negative-prompt=-blurry, low quality".to_string()));
        // An empty one is left to the engine's own default, the empty string.
        req.negative_prompt = Some("  ".into());
        let args = strings(&command_args(e, pack, Path::new("/m"), None, &req, Some((1024, 1024)), Path::new("/o.png"), false));
        assert!(!args.iter().any(|a| a.starts_with("--negative-prompt")));

        // What the catalogue tells Create: these two take its sliders.
        assert!(pack.user_sampling() && pack_of("qwen-image-2.1-4bit").user_sampling());
        for id in ["qwen-image-2.1-turbo", "z-image-turbo-4bit", "z-image-turbo-8bit", "flux2-klein-4b-4bit", "qwen-image-2512-8bit"] {
            assert!(!pack_of(id).user_sampling(), "{id}");
        }
    }

    #[test]
    fn an_edit_hands_over_its_images_and_the_side_they_are_scaled_to() {
        let e = entry("qwen-image-2.1-8bit");
        let pack = pack_of(e.id);
        let model = Path::new("/c/mflux/qwen-image-2.1-8bit");
        let out = Path::new("/i/o.png");
        let mut req = request("-make the car blue");
        req.seed = Some(7);
        req.steps = Some(25);
        req.images = vec![PathBuf::from("/v/start-images/a.png")];
        req.resolution = Some(1024);
        // One image and no size: the result takes the shape of that image.
        assert_eq!(canvas(e, &req), None);
        let args = strings(&command_args(e, pack, model, None, &req, canvas(e, &req), out, false));
        assert_eq!(
            args,
            [
                "-m",
                "mflux.models.qwen21.cli.qwen21_edit_generate",
                "--model",
                "/c/mflux/qwen-image-2.1-8bit",
                "--base-model",
                "qwen-image-2.1",
                "--prompt=-make the car blue",
                "--steps",
                "25",
                "--seed",
                "7",
                "--guidance",
                "1",
                "--image-paths",
                "/v/start-images/a.png",
                "--output-resolution",
                "1056",
                "--no-exif",
                "--output",
                "/i/o.png",
            ]
        );

        // Several images, the edited one first, and the size worked out
        // from it: left out, the engine takes the shape of the last one.
        req.images.push(PathBuf::from("/v/start-images/b.jpg"));
        req.images.push(PathBuf::from("/v/start-images/c.webp"));
        req.width = Some(1344);
        req.height = Some(768);
        req.resolution = Some(1000);
        assert_eq!(canvas(e, &req), Some((1344, 768)));
        let args = strings(&command_args(e, pack, model, None, &req, canvas(e, &req), out, true));
        let at = args.iter().position(|a| a == "--image-paths").unwrap();
        assert_eq!(
            &args[at..at + 6],
            ["--image-paths", "/v/start-images/a.png", "/v/start-images/b.jpg", "/v/start-images/c.webp", "--output-resolution", "992"],
            "the flag takes every value up to the next flag"
        );
        assert!(args.windows(4).any(|w| w == ["--width", "1344", "--height", "768"]));
        // One side alone is no size.
        req.height = None;
        assert_eq!(canvas(e, &req), None);
        // No side given: the catalogue's, as for the canvas.
        req.resolution = None;
        let args = strings(&command_args(e, pack, model, None, &req, None, out, false));
        assert!(args.windows(2).any(|w| w == ["--output-resolution", "1056"]));

        // An image from text keeps its canvas whatever else is set.
        let mut plain = request("a cat");
        plain.width = Some(1000);
        assert_eq!(canvas(e, &plain), Some((992, 1024)));
    }

    #[test]
    fn the_turbo_entry_edits_at_its_six_steps_without_guidance() {
        let e = entry("qwen-image-2.1-turbo");
        let mut req = request("a cat");
        req.steps = Some(30);
        req.guidance = Some(4.0);
        req.negative_prompt = Some("blurry".into());
        req.images = vec![PathBuf::from("/v/start-images/a.png")];
        let lora = Path::new("/c/mflux/_loras/x/turbo.safetensors");
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/m"), Some(lora), &req, None, Path::new("/o.png"), false));
        assert!(args.windows(2).any(|w| w == ["--steps", "6"]));
        // The adapter is distilled without guidance: the engine's own 1.
        assert!(!args.iter().any(|a| a == "--guidance" || a.starts_with("--negative-prompt")), "{args:?}");
        let at = args.iter().position(|a| a == "--image-paths").unwrap();
        assert_eq!(&args[at..at + 5], ["--image-paths", "/v/start-images/a.png", "--output-resolution", "1056", "--scheduler"]);
        assert_eq!(pack_of(e.id).edit_images(), 10);
    }

    #[test]
    fn a_painted_mask_and_a_strength_reach_the_engine_with_the_edit() {
        let (e, pack) = (entry("qwen-image-2.1-4bit"), pack_of("qwen-image-2.1-4bit"));
        let (model, out) = (Path::new("/m/pack"), Path::new("/o/x.png"));
        let mut req = request("a bright orange tennis ball");
        req.images = vec![PathBuf::from("/v/start-images/a.png")];
        req.mask = Some(PathBuf::from("/v/start-images/mask.png"));
        req.strength = Some(0.6);
        let args = strings(&command_args(e, pack, model, None, &req, canvas(e, &req), out, true));
        let at = args.iter().position(|a| a == "--image-paths").unwrap();
        assert_eq!(
            &args[at..at + 8],
            ["--image-paths", "/v/start-images/a.png", "--output-resolution", "1056", "--mask-image", "/v/start-images/mask.png", "--strength", "0.6"]
        );
        // At 1 the engine's own default runs, and the flag is left out.
        req.strength = Some(1.0);
        req.mask = None;
        let args = strings(&command_args(e, pack, model, None, &req, canvas(e, &req), out, true));
        assert!(!args.iter().any(|a| a == "--strength" || a == "--mask-image"), "{args:?}");
    }

    #[test]
    fn a_strength_is_for_an_edit_and_held_inside_what_the_engine_takes() {
        let one = [PathBuf::from("/v/start-images/a.png")];
        assert_eq!(edit_strength(&one, Some(0.7)), Some(0.7));
        assert_eq!(edit_strength(&one, Some(0.0)), Some(MIN_EDIT_STRENGTH), "the engine refuses 0");
        assert_eq!(edit_strength(&one, Some(-3.0)), Some(MIN_EDIT_STRENGTH));
        assert_eq!(edit_strength(&one, Some(1.0)), None);
        assert_eq!(edit_strength(&one, Some(4.0)), None);
        assert_eq!(edit_strength(&one, Some(f32::NAN)), None);
        assert_eq!(edit_strength(&one, None), None);
        assert_eq!(edit_strength(&[], Some(0.5)), None, "an image from text has nothing to start from");
    }

    #[test]
    fn only_a_staged_mask_over_an_image_reaches_the_engine() {
        let root = tempfile::tempdir().unwrap();
        let staged = root.path().join("start-images");
        put(staged.join("a.png"), 4);
        put(staged.join("mask.png"), 4);
        put(root.path().join("elsewhere.png"), 4);
        let images = [staged.join("a.png")];
        let path = |p: PathBuf| p.to_string_lossy().to_string();
        assert_eq!(edit_mask(&images, None, &staged), Ok(None));
        let mask = edit_mask(&images, Some(&path(staged.join("mask.png"))), &staged).unwrap().unwrap();
        assert!(mask.ends_with("mask.png"));
        let gone = "The mask is no longer on disk. Paint it again.";
        assert_eq!(edit_mask(&images, Some(&path(staged.join("missing.png"))), &staged).unwrap_err(), gone);
        assert_eq!(edit_mask(&images, Some(&path(root.path().join("elsewhere.png"))), &staged).unwrap_err(), gone);
        assert_eq!(edit_mask(&images, Some(&path(staged.join("..").join("elsewhere.png"))), &staged).unwrap_err(), gone);
        assert_eq!(edit_mask(&images, Some(&path(staged.clone())), &staged).unwrap_err(), gone, "a folder is not a mask");
        assert_eq!(
            edit_mask(&[], Some(&path(staged.join("mask.png"))), &staged).unwrap_err(),
            "A mask needs the image it was painted on. Add the image again."
        );
    }

    #[test]
    fn only_staged_images_reach_the_engine_and_only_a_model_that_edits_takes_them() {
        let root = tempfile::tempdir().unwrap();
        let staged = root.path().join("start-images");
        put(staged.join("a.png"), 4);
        put(staged.join("b.png"), 4);
        put(root.path().join("elsewhere.png"), 4);
        let path = |p: PathBuf| p.to_string_lossy().to_string();
        let e = entry("qwen-image-2.1-8bit");
        let pack = pack_of(e.id);
        assert_eq!(edit_images(e, pack, &[], &staged), Ok(Vec::new()), "an image from text");
        let two = edit_images(e, pack, &[path(staged.join("a.png")), path(staged.join("b.png"))], &staged).unwrap();
        assert_eq!(two.len(), 2);
        assert!(two[0].ends_with("a.png") && two[1].ends_with("b.png"), "in the order they were given");
        // Anything else the interface could name is refused: the engine
        // opens whatever it is handed.
        let gone = "The image to edit is no longer on disk. Add it again.";
        assert_eq!(edit_images(e, pack, &[path(staged.join("missing.png"))], &staged).unwrap_err(), gone);
        assert_eq!(edit_images(e, pack, &[path(root.path().join("elsewhere.png"))], &staged).unwrap_err(), gone);
        assert_eq!(edit_images(e, pack, &[path(staged.join("..").join("elsewhere.png"))], &staged).unwrap_err(), gone);
        assert_eq!(edit_images(e, pack, &[path(staged.clone())], &staged).unwrap_err(), gone, "a folder is not an image");
        assert_eq!(edit_images(e, pack, &[path(staged.join("a.png"))], &root.path().join("no-such-folder")).unwrap_err(), gone);
        // The engine's own limit.
        let eleven: Vec<String> = (0..11).map(|_| path(staged.join("a.png"))).collect();
        assert_eq!(edit_images(e, pack, &eleven, &staged).unwrap_err(), "Qwen-Image 2.1 8-bit takes at most 10 images in one edit.");
        assert_eq!(edit_images(e, pack, &eleven[..10], &staged).unwrap().len(), 10);
        // A model that makes images from text says so and does not run.
        for id in ["z-image-turbo-4bit", "flux2-klein-4b-4bit", "qwen-image-2512-8bit"] {
            assert_eq!(pack_of(id).edit_images(), 0, "{id}");
            let err = edit_images(entry(id), pack_of(id), &[path(staged.join("a.png"))], &staged).unwrap_err();
            assert!(err.ends_with("cannot edit an image. Pick Qwen-Image 2.1 for Edit."), "{err}");
        }
        for id in ["qwen-image-2.1-8bit", "qwen-image-2.1-4bit", "qwen-image-2.1-turbo"] {
            assert_eq!(pack_of(id).edit_images(), 10, "{id}");
        }
        // Where Create stages them, next to the start images of a video.
        assert_eq!(staged_images_dir(), crate::commands::video::outputs_root().join("start-images"));
        assert!(include_str!("media_cmds.rs").contains("crate::commands::video::outputs_root().join(\"start-images\")"));
    }

    #[test]
    fn the_size_of_the_result_is_read_from_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("o.png");
        let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
        bytes.extend_from_slice(&1344u32.to_be_bytes());
        bytes.extend_from_slice(&768u32.to_be_bytes());
        std::fs::write(&png, &bytes).unwrap();
        assert_eq!(png_size(&png), Some((1344, 768)));
        std::fs::write(&png, b"\xFF\xD8\xFF\xE0 not a png, and long enough to read").unwrap();
        assert_eq!(png_size(&png), None);
        std::fs::write(&png, b"\x89PNG").unwrap();
        assert_eq!(png_size(&png), None, "a file that was cut short");
        assert_eq!(png_size(&dir.path().join("none.png")), None);
    }

    #[test]
    fn the_step_is_read_from_the_bar_the_engine_draws() {
        assert_eq!(bar_progress(" 50%|#####     | 20/40 [00:31<00:31,  1.57s/it]"), Some((20, 40)));
        assert_eq!(bar_progress("100%|██████████| 6/6 [00:21<00:00,  3.55s/it]"), Some((6, 6)));
        assert_eq!(bar_progress("  0%|          | 0/25 [00:00<?, ?it/s]"), Some((0, 25)));
        assert_eq!(bar_progress("100%|x| 2/2"), Some((2, 2)));
        for line in ["Peak MLX memory: 12.10 GB", "ValueError: a|b", "x| /40 [", "x| 3/ [", "x| 3/0 [", ""] {
            assert_eq!(bar_progress(line), None, "{line}");
        }
        let runs = Runs::new();
        assert_eq!(runs.progress(), (false, 0, 0));
        *runs.pid() = Some(1);
        runs.steps.store(40, std::sync::atomic::Ordering::SeqCst);
        runs.note(" 50%|#####     | 20/40 [00:31<00:31,  1.57s/it]");
        assert_eq!(runs.progress(), (true, 20, 40));
        // The image decoded in tiles draws a bar of its own.
        runs.note(" 50%|#####     | 2/4 [00:01<00:01,  1.57s/it]");
        assert_eq!(runs.progress(), (true, 20, 40));
        *runs.pid() = None;
        assert_eq!(runs.progress(), (false, 0, 0), "a run that ended reports nothing");
    }

    #[test]
    fn the_turbo_line_carries_the_adapter_unmerged_at_six_steps() {
        let e = entry("qwen-image-2.1-turbo");
        let mut req = request("a lighthouse");
        req.steps = Some(30);
        let lora = Path::new("/c/mflux/_loras/Viggle--Qwen-Image-2.1-viggle-turbo/turbo.safetensors");
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/c/mflux/qwen-image-2.1-8bit"), Some(lora), &req, Some((1024, 1024)), Path::new("/i/o.png"), false));
        assert!(args.windows(2).any(|w| w == ["--steps", "6"]), "any other count is an error in the engine: {args:?}");
        let at = args.iter().position(|a| a == "--scheduler").unwrap();
        assert_eq!(
            &args[at..at + 6],
            ["--scheduler", "viggle_turbo", "--lora", "/c/mflux/_loras/Viggle--Qwen-Image-2.1-viggle-turbo/turbo.safetensors", "1.0", "--no-bake-lora"]
        );
        // `--lora` takes a path and a scale, and whatever follows the scale
        // has to be a flag again.
        assert!(args[at + 6].starts_with("--"));
    }

    #[test]
    fn the_lora_stack_goes_out_as_one_lora_flag_per_file_unmerged() {
        let e = entry("qwen-image-2.1-8bit");
        let mut req = request("a lighthouse");
        req.loras = vec![
            (PathBuf::from("/d/loras/detail fix.safetensors"), 0.8),
            (PathBuf::from("/d/loras/qwen/slider.safetensors"), -4.0),
            (PathBuf::from("/d/loras/full.safetensors"), 1.0),
        ];
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/m"), None, &req, Some((1024, 1024)), Path::new("/i/o.png"), false));
        let at = args.iter().position(|a| a == "--lora").unwrap();
        assert_eq!(
            &args[at..at + 10],
            [
                "--lora", "/d/loras/detail fix.safetensors", "0.8",
                "--lora", "/d/loras/qwen/slider.safetensors", "-4",
                "--lora", "/d/loras/full.safetensors", "1",
                "--no-bake-lora",
            ]
        );
        assert_eq!(args.iter().filter(|a| *a == "--no-bake-lora").count(), 1);
        // The plain pack keeps its own schedule and the user's steps.
        assert!(!args.iter().any(|a| a == "--scheduler"));
        assert!(args.windows(2).any(|w| w == ["--steps", "25"]));
        // Whatever follows the stack is a flag again.
        assert!(args[at + 10].starts_with("--"));

        // Without a stack nothing of it is on the line.
        let none = strings(&command_args(e, pack_of(e.id), Path::new("/m"), None, &request("x"), Some((1024, 1024)), Path::new("/i/o.png"), false));
        assert!(!none.iter().any(|a| a == "--lora" || a == "--no-bake-lora"));
    }

    #[test]
    fn turbo_keeps_its_adapter_in_front_of_the_stack() {
        let e = entry("qwen-image-2.1-turbo");
        let mut req = request("a lighthouse");
        req.loras = vec![(PathBuf::from("/d/loras/style.safetensors"), 0.6)];
        let adapter = Path::new("/c/mflux/_loras/x/turbo.safetensors");
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/m"), Some(adapter), &req, Some((1024, 1024)), Path::new("/i/o.png"), false));
        let at = args.iter().position(|a| a == "--scheduler").unwrap();
        assert_eq!(
            &args[at..at + 9],
            [
                "--scheduler", "viggle_turbo",
                "--lora", "/c/mflux/_loras/x/turbo.safetensors", "1.0",
                "--lora", "/d/loras/style.safetensors", "0.6",
                "--no-bake-lora",
            ]
        );
        assert!(args.windows(2).any(|w| w == ["--steps", "6"]));
    }

    #[test]
    fn an_edit_and_every_other_family_carry_the_stack_too() {
        let stack = vec![(PathBuf::from("/d/loras/style.safetensors"), 1.25)];
        let e = entry("qwen-image-2.1-4bit");
        let mut edit = request("make the car blue");
        edit.images = vec![PathBuf::from("/v/start-images/a.png"), PathBuf::from("/v/start-images/b.png")];
        edit.loras = stack.clone();
        let args = strings(&command_args(e, pack_of(e.id), Path::new("/m"), None, &edit, Some((1344, 768)), Path::new("/o.png"), true));
        let at = args.iter().position(|a| a == "--image-paths").unwrap();
        assert_eq!(
            &args[at..at + 10],
            [
                "--image-paths", "/v/start-images/a.png", "/v/start-images/b.png", "--output-resolution", "1056",
                "--lora", "/d/loras/style.safetensors", "1.25", "--no-bake-lora", "--low-ram",
            ]
        );
        for id in ["z-image-turbo-4bit", "flux2-klein-4b-4bit", "qwen-image-2512-8bit"] {
            assert!(pack_of(id).takes_loras());
            let mut req = request("x");
            req.loras = stack.clone();
            let args = strings(&command_args(entry(id), pack_of(id), Path::new("/m"), None, &req, Some((1024, 1024)), Path::new("/o.png"), false));
            assert!(args.windows(4).any(|w| w == ["--lora", "/d/loras/style.safetensors", "1.25", "--no-bake-lora"]), "{id}: {args:?}");
        }
    }

    #[test]
    fn a_lora_is_taken_from_the_lora_folder_alone_and_in_a_format_the_model_reads() {
        use crate::commands::mlx_loras::tests::{write_lora, KOHYA, PEFT};
        let dir = crate::os_paths::test_dir("mflux-loras");
        let folder = dir.join("loras");
        write_lora(&folder.join("style.safetensors"), PEFT);
        write_lora(&folder.join("qwen/detail.safetensors"), PEFT);
        write_lora(&folder.join("kohya.safetensors"), KOHYA);
        write_lora(&folder.join("dora.safetensors"), &["transformer.a.lora_A.weight", "transformer.a.lora_B.weight", "transformer.a.lora_magnitude_vector.weight"]);
        write_lora(&dir.join("outside.safetensors"), PEFT);
        std::fs::write(folder.join("page.safetensors"), b"<html>sign in to download</html>").unwrap();
        let real = folder.canonicalize().unwrap();

        let e = entry("qwen-image-2.1-8bit");
        let pack = pack_of(e.id);
        let ask = |names: &[(&str, f32)]| -> Vec<(String, f32)> { names.iter().map(|(n, s)| (n.to_string(), *s)).collect() };

        // In the order they were picked, each strength inside its range.
        let ok = lora_files(e, pack, &ask(&[("qwen/detail.safetensors", 0.8), ("style.safetensors", 25.0)]), &folder).unwrap();
        assert_eq!(ok, [(real.join("qwen/detail.safetensors"), 0.8), (real.join("style.safetensors"), 10.0)]);

        // Nothing outside the folder, by any spelling. One bad name ends the run.
        let outside = dir.join("outside.safetensors");
        for bad in ["../outside.safetensors", outside.to_str().unwrap(), "qwen/../../outside.safetensors", "style", "/etc/hosts"] {
            let said = lora_files(e, pack, &ask(&[("style.safetensors", 1.0), (bad, 1.0)]), &folder).unwrap_err();
            assert!(said.starts_with("This LoRA is not a .safetensors file"), "{bad}: {said}");
        }
        let gone = lora_files(e, pack, &ask(&[("gone.safetensors", 1.0)]), &folder).unwrap_err();
        assert!(gone.contains("The LoRA gone is no longer in the LoRA folder"), "{gone}");

        // Qwen-Image 2.1 reads lora_A / lora_B alone. Said before the model loads.
        let kohya = lora_files(e, pack, &ask(&[("kohya.safetensors", 1.0)]), &folder).unwrap_err();
        assert!(kohya.starts_with("kohya is not in a format Qwen-Image 2.1") && kohya.contains("lora_A and lora_B"), "{kohya}");
        let turbo = entry("qwen-image-2.1-turbo");
        assert!(lora_files(turbo, pack_of(turbo.id), &ask(&[("kohya.safetensors", 1.0)]), &folder).is_err());
        // The other families read the Kohya naming and judge the file themselves.
        for id in ["z-image-turbo-4bit", "flux2-klein-4b-4bit", "qwen-image-2512-8bit"] {
            let taken = lora_files(entry(id), pack_of(id), &ask(&[("kohya.safetensors", 0.5)]), &folder).unwrap();
            assert_eq!(taken, [(real.join("kohya.safetensors"), 0.5)], "{id}");
        }
        // No family reads a DoRA or a file that is no safetensors at all.
        for id in ["qwen-image-2.1-8bit", "z-image-turbo-4bit"] {
            let dora = lora_files(entry(id), pack_of(id), &ask(&[("dora.safetensors", 1.0)]), &folder).unwrap_err();
            assert!(dora.starts_with("dora is a DoRA"), "{id}: {dora}");
            let page = lora_files(entry(id), pack_of(id), &ask(&[("page.safetensors", 1.0)]), &folder).unwrap_err();
            assert!(page.starts_with("page is not a LoRA file the image engine can read"), "{id}: {page}");
        }
    }

    #[test]
    fn qwen_image_21_is_handed_the_strength_times_the_alpha_share_of_the_file() {
        use crate::commands::mlx_loras::tests::{f32_alpha, write_alpha_lora, write_tensors};
        let dir = crate::os_paths::test_dir("mflux-lora-alpha");
        let folder = dir.join("loras");
        write_alpha_lora(&folder.join("half.safetensors"), &[(16, f32_alpha(8.0)), (16, f32_alpha(8.0))]);
        write_alpha_lora(&folder.join("plain.safetensors"), &[(16, None), (16, None)]);
        write_alpha_lora(&folder.join("mixed.safetensors"), &[(16, f32_alpha(8.0)), (16, f32_alpha(16.0))]);
        // An alpha the header points at and the file does not hold.
        write_alpha_lora(&folder.join("cut.safetensors"), &[(16, f32_alpha(8.0)), (16, f32_alpha(8.0))]);
        let whole = std::fs::read(folder.join("cut.safetensors")).unwrap();
        let header_end = 8 + u64::from_le_bytes(whole[..8].try_into().unwrap()) as usize;
        std::fs::write(folder.join("cut.safetensors"), &whole[..header_end + 2]).unwrap();
        write_tensors(
            &folder.join("kohya.safetensors"),
            &[
                ("lora_unet_blocks_0_attn_to_q.lora_down.weight", "F32", &[16, 4], vec![0u8; 256]),
                ("lora_unet_blocks_0_attn_to_q.lora_up.weight", "F32", &[4, 16], vec![0u8; 256]),
                ("lora_unet_blocks_0_attn_to_q.alpha", "F32", &[], 8f32.to_le_bytes().to_vec()),
            ],
        );
        let real = folder.canonicalize().unwrap();
        let ask = |names: &[(&str, f32)]| -> Vec<(String, f32)> { names.iter().map(|(n, s)| (n.to_string(), *s)).collect() };
        let stack = ask(&[("half.safetensors", 0.8), ("plain.safetensors", 0.8), ("mixed.safetensors", 0.8), ("cut.safetensors", 0.8), ("half.safetensors", -4.0)]);

        for id in ["qwen-image-2.1-8bit", "qwen-image-2.1-turbo"] {
            let e = entry(id);
            let taken = lora_files(e, pack_of(id), &stack, &folder).unwrap();
            let strengths: Vec<f32> = taken.iter().map(|(_, s)| *s).collect();
            // Half of what was asked, and the three others as they were asked.
            assert_eq!(strengths, [0.4, 0.8, 0.8, 0.8, -2.0], "{id}");

            // What the engine is handed, and what the log says of it.
            let mut req = request("a cat");
            req.loras = taken;
            assert_eq!(strengths_said(&req.loras), " at 0.4, 0.8, 0.8, 0.8, -2");
            let args = strings(&command_args(e, pack_of(id), Path::new("/m"), None, &req, None, Path::new("/o.png"), false));
            let at = args.iter().position(|a| a.ends_with("half.safetensors")).unwrap() - 1;
            let path = |name: &str| real.join(name).to_string_lossy().into_owned();
            assert_eq!(
                args[at..at + 16],
                [
                    "--lora", path("half.safetensors").as_str(), "0.4",
                    "--lora", path("plain.safetensors").as_str(), "0.8",
                    "--lora", path("mixed.safetensors").as_str(), "0.8",
                    "--lora", path("cut.safetensors").as_str(), "0.8",
                    "--lora", path("half.safetensors").as_str(), "-2",
                    "--no-bake-lora",
                ],
                "{id}"
            );
        }

        // The other families read the alpha of a file themselves.
        for id in ["z-image-turbo-4bit", "flux2-klein-4b-4bit", "qwen-image-2512-8bit"] {
            let taken = lora_files(entry(id), pack_of(id), &ask(&[("half.safetensors", 0.8), ("kohya.safetensors", 0.8)]), &folder).unwrap();
            assert_eq!(taken, [(real.join("half.safetensors"), 0.8), (real.join("kohya.safetensors"), 0.8)], "{id}");
        }
    }

    #[test]
    fn the_log_says_what_the_alpha_of_a_file_did_to_its_strength() {
        use crate::commands::mlx_loras::Alpha;
        assert_eq!(alpha_said("style", 0.8, Alpha::None), None);
        assert_eq!(
            alpha_said("style", 0.8, Alpha::Uniform(0.5)).unwrap(),
            "LoRA style: alpha / rank is 0.5, strength 0.8 goes to the engine as 0.4"
        );
        assert_eq!(
            alpha_said("style", 0.8, Alpha::Mixed).unwrap(),
            "LoRA style: alpha / rank differs from layer to layer, strength 0.8 goes to the engine as it is"
        );
        assert_eq!(strengths_said(&[]), "");
        assert_eq!(strengths_said(&[(PathBuf::from("a.safetensors"), 0.4), (PathBuf::from("b.safetensors"), -4.0)]), " at 0.4, -4");
        // The run's line carries them.
        let source = include_str!("image_mflux.rs");
        let generate = &source[source.find("pub(super) async fn generate(").unwrap()..];
        assert!(generate[..generate.find("spawn_blocking").unwrap()].contains("strengths_said(&req.loras),"));
    }

    #[test]
    fn the_stack_is_checked_before_anything_is_unloaded_and_the_sidecar_refuses_one() {
        let mlx = include_str!("mlx.rs");
        let generate = &mlx[mlx.find("pub async fn mlx_generate(").unwrap()..];
        let generate = &generate[..generate.find("\npub(crate) fn images_root()").unwrap()];
        assert!(generate.find("mflux::request_loras(").unwrap() < generate.find("mflux::claim_run(").unwrap());
        assert!(generate.find("mflux::request_loras(").unwrap() < generate.find("mlx_unload(").unwrap());
        let sidecar = &generate[generate.find("return mflux::generate(").unwrap()..];
        assert!(sidecar.find("takes no LoRA").unwrap() < sidecar.find("SidecarImage::begin(").unwrap());
        // Every entry says whether it takes the stack: the packs of this
        // engine do, the sidecar's models do not.
        assert!(mlx.contains("\"loras\": c.mflux.is_some_and(|pack| pack.takes_loras()),"));
    }

    #[test]
    fn each_family_gets_its_own_command_and_only_the_flags_it_takes() {
        let out = Path::new("/i/o.png");
        let mut req = request("x");
        req.negative_prompt = Some("blurry".into());
        // What Create's slider stands at does not reach a pack that runs at
        // its own guidance.
        req.guidance = Some(7.0);
        for (id, module, base) in [
            ("z-image-turbo-4bit", "mflux.models.z_image.cli.z_image_turbo_generate", "z-image-turbo"),
            ("z-image-turbo-8bit", "mflux.models.z_image.cli.z_image_turbo_generate", "z-image-turbo"),
            ("flux2-klein-4b-4bit", "mflux.models.flux2.cli.flux2_generate", "flux2-klein-4b"),
            ("qwen-image-2512-8bit", "mflux.models.qwen.cli.qwen_image_generate", "qwen-image"),
        ] {
            let e = entry(id);
            let args = strings(&command_args(e, pack_of(id), Path::new("/m"), None, &req, Some((1024, 1024)), out, false));
            assert_eq!(&args[..2], ["-m", module], "{id}");
            assert!(args.windows(2).any(|w| w == ["--base-model", base]), "{id}");
            assert!(args.windows(2).any(|w| w == ["--steps", e.steps.to_string().as_str()]), "{id}");
            let guided = id == "qwen-image-2512-8bit";
            // The FLUX.2 command ends with an error on a negative prompt.
            assert_eq!(args.contains(&"--negative-prompt=blurry".to_string()), guided, "{id}");
            assert_eq!(args.windows(2).any(|w| w == ["--guidance", "3.5"]), guided, "{id}");
            assert!(!args.iter().any(|a| a == "--guidance") || guided, "{id}");
            assert!(!args.iter().any(|a| a == "--scheduler" || a == "--lora" || a == "--image-paths"), "{id}");
        }
        assert_eq!(steps_for(entry("qwen-image-2.1-8bit"), pack_of("qwen-image-2.1-8bit"), Some(1)), 2, "the engine refuses one step");
        assert_eq!(steps_for(entry("qwen-image-2.1-8bit"), pack_of("qwen-image-2.1-8bit"), None), 25, "where Windows starts");
        assert_eq!(steps_for(entry("flux2-klein-4b-4bit"), pack_of("flux2-klein-4b-4bit"), Some(1)), 1);
    }

    #[cfg(unix)]
    fn status_of(script: &str) -> std::process::ExitStatus {
        crate::process_util::foreign_system_command(crate::test_support::posix_shell()).arg("-c").arg(script).status().unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn the_end_of_a_generation_is_said_in_a_sentence() {
        let none: Vec<String> = Vec::new();
        let lines = |text: &str| text.lines().map(String::from).collect::<Vec<_>>();
        assert_eq!(outcome(&status_of("exit 0"), true, &none, &none, false), Ok(()));
        // The folder is not a model: the last line of the traceback, not a frame of it.
        let trace = lines("Traceback (most recent call last):\nFile \"/v/x.py\", line 97, in _execute\nraise FileNotFoundError(\nFileNotFoundError: Model not found: '/m'. If local path, make sure it exists.");
        assert_eq!(
            outcome(&status_of("exit 1"), false, &none, &trace, false).unwrap_err(),
            "The image engine stopped: FileNotFoundError: Model not found: '/m'. If local path, make sure it exists."
        );
        assert_eq!(outcome(&status_of("exit 3"), false, &none, &none, false).unwrap_err(), "The image engine stopped with exit code 3 and no message.");
        // A LoRA of another family: the file by name and what to do, not key endings.
        let foreign = lines("Traceback (most recent call last):\nValueError: No LoRA layers were applied from my style v2.safetensors. Key endings seen in the file: ['lora_A.weight', 'lora_B.weight']. This model's mapping expects endings like lora_A/lora_B");
        assert_eq!(
            outcome(&status_of("exit 1"), false, &none, &foreign, false).unwrap_err(),
            "my style v2.safetensors is not a LoRA for this model: none of its layers has a name this model knows. Take it off the stack, or pick one made for this model."
        );
        assert_eq!(foreign_lora("ValueError: the pack is not complete"), None);
        // The engine ends a run by itself with success and one printed line.
        let said = lines("Stopping image generation at step 3/40\nPeak MLX memory: 12.10 GB");
        assert_eq!(
            outcome(&status_of("exit 0"), false, &said, &lines(" 5%|▌ | 2/40 [00:03<01:02, 1.61s/it]"), false).unwrap_err(),
            "The image engine finished without writing an image: Stopping image generation at step 3/40"
        );
        // Taken away by the system, and ended by the app itself.
        let killed = status_of("kill -9 $$");
        assert!(outcome(&killed, false, &none, &none, false).unwrap_err().contains("did not fit into memory"));
        assert_eq!(outcome(&killed, false, &none, &none, true).unwrap_err(), "The image was not finished because the app stopped the engine.");
    }

    #[cfg(unix)]
    #[test]
    fn a_run_reports_the_engines_last_word_and_frees_the_slot() {
        let out = tempfile::tempdir().unwrap();
        let png = out.path().join("o.png");
        let sh = |script: String| {
            let mut cmd = crate::process_util::foreign_system_command(crate::test_support::posix_shell());
            cmd.arg("-c").arg(script);
            cmd
        };
        // A slot of the test's own: the quit path, which other tests run,
        // ends whatever the app's slot holds.
        let runs = Runs::new();
        // A progress bar on the carriage return, then the file.
        run(&runs, sh(format!("printf ' 50%%|x| 1/2 [00:01<00:01, 1.0s/it]\\r100%%|x| 2/2' >&2; : > '{}'", png.display())), &png, 2, None).unwrap();
        assert!(png.is_file() && !runs.busy());
        assert_eq!(runs.step.load(std::sync::atomic::Ordering::SeqCst), 2, "the bar was read while the run went on");
        let err = run(&runs, sh("echo 'ValueError: the pack is not complete' >&2; exit 1".to_string()), &png, 2, None).unwrap_err();
        assert_eq!(err, "The image engine stopped: ValueError: the pack is not complete");
        assert!(!png.exists(), "the image of the run before must not pass for this one");
        assert!(!runs.busy(), "a failed run still holds the slot");

        // Stopped by the app: said as that, and not as a Mac out of memory.
        let runs = std::sync::Arc::new(Runs::new());
        let stopper = runs.clone();
        let killer = std::thread::spawn(move || {
            while !stopper.busy() {
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            stopper.stop()
        });
        let err = run(&runs, sh("sleep 30".to_string()), &png, 2, None).unwrap_err();
        assert!(killer.join().unwrap(), "stop says that it ended a run");
        assert!(!runs.stop(), "and that there is none to end");
        assert_eq!(err, "The image was not finished because the app stopped the engine.");
        assert!(!runs.busy());
    }

    /// Fehlerkontrolle Mac 3, Fund 6: a run counts from the moment it is
    /// accepted. Remove and the sidecar ask `busy`, and the seconds in which
    /// the sidecar unloads were a time in which it said "nothing runs".
    #[test]
    fn a_run_is_busy_from_its_claim_and_one_run_holds_the_place() {
        let runs = Runs::new();
        assert!(!runs.busy());
        let claim = runs.claim(Some("a".into())).expect("the place is free");
        assert!(runs.busy(), "an accepted run without a process was invisible");
        assert!(runs.claim(Some("b".into())).is_none(), "two runs were accepted");
        drop(claim);
        assert!(!runs.busy(), "a run that is over still holds the place");
        assert!(runs.claim(None).is_some());
    }

    /// Cancel while the run has no process yet: it does not start one.
    #[cfg(unix)]
    #[test]
    fn a_stop_before_the_process_is_up_keeps_it_from_starting() {
        let out = tempfile::tempdir().unwrap();
        let (png, mark) = (out.path().join("o.png"), out.path().join("ran"));
        let runs = Runs::new();
        assert!(!runs.stop(), "there is nothing to stop");
        let _claim = runs.claim(None).unwrap();
        assert!(runs.stop(), "a run that was accepted can be stopped");
        let mut cmd = crate::process_util::foreign_system_command(crate::test_support::posix_shell());
        cmd.arg("-c").arg(format!(": > '{}'; : > '{}'", mark.display(), png.display()));
        let err = run(&runs, cmd, &png, 2, None).unwrap_err();
        assert_eq!(err, "The image was not finished because the app stopped the engine.");
        assert!(!mark.exists(), "the engine was started after the stop");
        // The mark is used up: the next run of this place starts.
        let mut cmd = crate::process_util::foreign_system_command(crate::test_support::posix_shell());
        cmd.arg("-c").arg(format!(": > '{}'", png.display()));
        run(&runs, cmd, &png, 2, None).unwrap();
    }

    /// Fund 12: a Cancel carries the name of its run, and a repeated one that
    /// arrives late does not end the run that followed.
    #[test]
    fn a_stop_by_name_ends_that_run_and_no_other() {
        let runs = Runs::new();
        assert!(!runs.stop_run(Some("old")));
        let _claim = runs.claim(Some("new".into())).unwrap();
        assert!(!runs.stop_run(Some("old")), "the Cancel of the run before ended this one");
        assert!(!runs.stopped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(runs.stop_run(Some("new")));
        assert!(runs.stopped.load(std::sync::atomic::Ordering::SeqCst));
        // Without a name it ends what runs: the quit path and old callers.
        let runs = Runs::new();
        let _claim = runs.claim(Some("x".into())).unwrap();
        assert!(runs.stop_run(None));
    }

    /// Fund 9: the gallery is told what the run took, and for a pack that
    /// reads no slider that is the engine's own number.
    #[test]
    fn the_guidance_reported_is_the_one_the_run_took() {
        for (id, asked, took) in [
            ("qwen-image-2.1-8bit", Some(4.0), 4.0),
            ("qwen-image-2.1-8bit", Some(0.0), 1.0),
            ("qwen-image-2.1-turbo", Some(4.0), 1.0),
            ("z-image-turbo-4bit", Some(4.0), 0.0),
            ("z-image-turbo-8bit", Some(3.5), 0.0),
            ("flux2-klein-4b-4bit", Some(7.0), 1.0),
        ] {
            assert_eq!(guidance_taken(entry(id), pack_of(id), asked), took, "{id}");
        }
        let qwen = entry("qwen-image-2512-8bit");
        assert_eq!(guidance_taken(qwen, pack_of(qwen.id), Some(9.0)), qwen.guidance);
        let generate = &production()[production().find("pub(super) async fn generate(").unwrap()..];
        assert!(generate.contains("let guidance = guidance_taken(entry, pack, req.guidance);"));
    }

    /// Fund 13: the pid of a generation is on disk while it runs.
    #[cfg(unix)]
    #[test]
    fn the_pid_of_a_run_is_noted_while_it_lives() {
        let out = tempfile::tempdir().unwrap();
        let (png, note, seen, own) = (out.path().join("o.png"), out.path().join("mlx").join("run.pid"), out.path().join("seen"), out.path().join("own"));
        let mut cmd = crate::process_util::foreign_system_command(crate::test_support::posix_shell());
        cmd.arg("-c").arg(format!(
            "echo $$ > '{own}'; n=0; while [ ! -s '{note}' ] && [ $n -lt 100 ]; do sleep 0.05; n=$((n+1)); done; cp '{note}' '{seen}'; : > '{png}'",
            own = own.display(),
            note = note.display(),
            seen = seen.display(),
            png = png.display()
        ));
        run(&Runs::new(), cmd, &png, 2, Some(&note)).unwrap();
        let read = |p: &Path| std::fs::read_to_string(p).unwrap_or_default().trim().to_string();
        assert!(!read(&own).is_empty());
        assert_eq!(read(&seen), read(&own), "the note did not name the process");
        assert!(!note.exists(), "the note outlived its run");
    }

    /// What may be ended at the next start: an mflux command on a pack of
    /// this app, left to launchd. Nothing else, whatever its pid.
    #[test]
    fn only_a_generation_of_ours_without_its_app_is_an_orphan() {
        let models = Path::new("/Users/x/Library/Caches/lu-labs/mflux");
        let cmd = |parts: &[&str]| parts.iter().map(|p| p.to_string()).collect::<Vec<_>>();
        let ours = cmd(&["/d/mlx/venv-mflux/bin/python", "-m", "mflux.models.qwen21.cli.qwen21_edit_generate", "--model", "/Users/x/Library/Caches/lu-labs/mflux/qwen-image-2.1-8bit", "--prompt=a cat"]);
        assert!(is_orphaned_run(&Leftover { parent: Some(1), cmd: ours.clone() }, models));
        // The generation of an app that is running.
        assert!(!is_orphaned_run(&Leftover { parent: Some(4242), cmd: ours.clone() }, models));
        assert!(!is_orphaned_run(&Leftover { parent: None, cmd: ours }, models));
        // The user's own mflux, on a model of theirs.
        let theirs = cmd(&["python", "-m", "mflux.models.qwen21.cli.qwen21_edit_generate", "--model", "/Users/x/models/qwen"]);
        assert!(!is_orphaned_run(&Leftover { parent: Some(1), cmd: theirs }, models));
        // Another program that got the pid.
        let other = cmd(&["/usr/bin/python3", "server.py", "--model", "/Users/x/Library/Caches/lu-labs/mflux/x"]);
        assert!(!is_orphaned_run(&Leftover { parent: Some(1), cmd: other }, models));
        assert!(!is_orphaned_run(&Leftover { parent: Some(1), cmd: Vec::new() }, models));
        // The prompt enhancer takes the same place: our script, on a model
        // in the same folder. A script of somebody else's is not ours.
        let script = format!("{}\nimport json", super::super::enhancer::SCRIPT_MARK);
        let enhancer = cmd(&["/d/mlx/venv/bin/python", "-c", &script, "--model", "/Users/x/Library/Caches/lu-labs/mflux/qwen-image-2.1-pe-t2i-4bit/4bit", "--out", "/x.json"]);
        assert!(is_orphaned_run(&Leftover { parent: Some(1), cmd: enhancer.clone() }, models));
        assert!(!is_orphaned_run(&Leftover { parent: Some(4242), cmd: enhancer }, models));
        let foreign = cmd(&["python", "-c", "import mlx_vlm", "--model", "/Users/x/Library/Caches/lu-labs/mflux/x"]);
        assert!(!is_orphaned_run(&Leftover { parent: Some(1), cmd: foreign }, models));
    }

    /// The prompt enhancer gets its request on its standard input and runs
    /// in the one place an image takes.
    #[cfg(unix)]
    #[test]
    fn a_child_reads_its_input_and_holds_the_place_while_it_runs() {
        let out = tempfile::tempdir().unwrap();
        let got = out.path().join("got.txt");
        let mut cmd = crate::process_util::foreign_system_command(crate::test_support::posix_shell());
        cmd.arg("-c").arg(format!("cat > '{}'; echo said; echo warned >&2", got.display()));
        let runs = Runs::new();
        let input = vec![b'x'; 200_000];
        let ended = run_child(&runs, cmd, 0, None, std::time::Duration::from_secs(30), Some(input.clone()), "prompt enhancer").unwrap();
        assert!(ended.status.is_some_and(|s| s.success()) && !ended.stopped);
        assert_eq!(std::fs::read(&got).unwrap(), input, "the whole request arrived");
        assert_eq!((ended.said, ended.warned), (vec!["said".to_string()], vec!["warned".to_string()]));
        assert!(!runs.busy());
    }

    /// Against real processes, on the platform the sweep runs on (Linux
    /// hands an orphan to the nearest subreaper, not to pid 1).
    #[cfg(target_os = "macos")]
    #[test]
    fn the_sweep_ends_a_real_leftover_run_and_spares_everything_else() {
        use std::process::{Command, Stdio};
        let dir = tempfile::tempdir().unwrap();
        let models = dir.path().join("mflux");
        std::fs::create_dir_all(models.join("pack")).unwrap();
        let note = dir.path().join("run.pid");
        let alive = |pid: u32| crate::test_support::is_alive(pid);
        let wait_until = |what: &dyn Fn() -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while std::time::Instant::now() < deadline && !what() {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            what()
        };
        // A stand-in with the command line of a generation. Its parent
        // leaves at once, as a crashed app does.
        let orphan_of = |model: &Path| -> u32 {
            let out = Command::new("sh")
                .arg("-c")
                .arg(r#"sh -c 'sleep 60 & wait' -m mflux.models.stand_in --model "$0" >/dev/null 2>&1 & echo $!"#)
                .arg(model)
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .expect("sh ran");
            String::from_utf8_lossy(&out.stdout).trim().parse().expect("a pid")
        };
        let parent_of = |pid: u32| {
            let table = crate::process_util::process_table_with_cmdlines();
            table.process(sysinfo::Pid::from_u32(pid)).and_then(|p| p.parent()).map(|p| p.as_u32())
        };

        let ours = orphan_of(&models.join("pack"));
        let theirs = orphan_of(&dir.path().join("elsewhere"));
        let orphaned = wait_until(&|| parent_of(ours) == Some(1) && parent_of(theirs) == Some(1));

        // A note that names a stranger: nothing is ended, the note goes.
        std::fs::write(&note, theirs.to_string()).unwrap();
        let spared = orphaned && reap_orphaned_run_at(&note, &models).is_none();
        let note_dropped = !note.exists();
        // A note that names this very test process: a living app's own.
        std::fs::write(&note, std::process::id().to_string()).unwrap();
        let self_spared = reap_orphaned_run_at(&note, &models).is_none();
        // The leftover run.
        std::fs::write(&note, ours.to_string()).unwrap();
        let ended = if orphaned { reap_orphaned_run_at(&note, &models) } else { None };
        let gone = wait_until(&|| !alive(ours));
        let stranger_alive = alive(theirs);

        // Clean up before any assertion can leave a process behind.
        for pid in [ours, theirs] {
            crate::process_util::kill_pid_tree(pid);
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }

        assert!(orphaned, "the stand-ins were never seen as children of pid 1");
        assert!(spared && stranger_alive, "a process that is not a generation of ours was ended");
        assert!(note_dropped, "the note of a stranger stays and is asked again at every start");
        assert!(self_spared, "a process with a living parent was ended");
        assert_eq!(ended, Some(ours));
        assert!(gone, "the leftover run survived the sweep");
        assert!(!note.exists());
        // No note, or one that is not a number: nothing happens.
        assert_eq!(reap_orphaned_run_at(&note, &models), None);
        std::fs::write(&note, "not a pid").unwrap();
        assert_eq!(reap_orphaned_run_at(&note, &models), None);
    }

    /// The narrow places where the image lane hands over to this engine.
    #[test]
    fn the_hooks_in_the_image_lane_are_where_they_belong() {
        let src = include_str!("mlx.rs");
        let body = |name: &str| {
            let from = &src[src.find(name).unwrap_or_else(|| panic!("{name} is gone"))..];
            &from[..from.find("\n}\n").unwrap()]
        };
        // Get: before anything asks for the sidecar's engine.
        let install = body("pub fn mlx_image_install_model(");
        assert!(install.find("mflux::install(").unwrap() < install.find("engine_not_ready_message").unwrap());
        // Generate: after the memory verdict, with the sidecar's model
        // unloaded first, and never through the sidecar's port.
        let generate = body("pub async fn mlx_generate(");
        let hook = generate.find("mflux::generate(").unwrap();
        assert!(generate.find("memory_verdict(").unwrap() < hook);
        assert!(generate.find("mlx_unload(").unwrap() < hook, "two engines would hold a model each");
        assert!(hook < generate.find(".post(").unwrap());
        assert!(generate.find("mflux::busy()").unwrap() < generate.find(".post(").unwrap());
        // Remove: not while an install writes into the folder.
        let delete = body("pub fn mlx_image_delete_model(");
        assert!(delete.find("is_running()").unwrap() < delete.find("mflux::delete(").unwrap());
        // The catalogue says which engine runs a model, and the status
        // whether that engine is there.
        assert!(body("pub fn mlx_image_models(").contains("\"family\": if c.mflux.is_some() { \"mflux\" } else { \"diffusers\" }"));
        assert!(body("pub async fn mlx_status(").contains("\"mfluxInstalled\": mflux::engine_ready()"));
        assert!(include_str!("../state.rs").contains("crate::commands::mlx::stop_mflux();"), "quit leaves the engine running");
        // An edit: checked before the sidecar's model is unloaded, and the
        // sidecar never runs one without its image.
        assert!(generate.find("mflux::request_images(").unwrap() < generate.find("mlx_unload(").unwrap());
        let refusal = generate.find("if !req.images.is_empty()").expect("the sidecar would drop the image");
        assert!(hook < refusal && refusal < generate.find(".post(").unwrap());
        let models = body("pub fn mlx_image_models(");
        assert!(models.contains("\"editImages\": c.mflux.map_or(0, |pack| pack.edit_images())"));
        assert!(models.contains("\"userSampling\": c.mflux.map(|pack| pack.user_sampling())"));
        // Cancel and progress reach the interface.
        assert!(body("pub fn mlx_generate_cancel(").contains("mflux::stop_run(run)"));
        assert!(body("pub fn mlx_generate_progress(").contains("mflux::progress()"));
        let registered = include_str!("../main.rs");
        for command in ["mlx_generate_progress", "mlx_generate_cancel"] {
            assert!(registered.contains(&format!("commands::media_cmds::{command},")), "{command} is not registered");
        }
    }

    /// Fund 3 and 11 of the Mac review, for this file too: no install thread
    /// without the panic guard, no slot claimed in two steps, the disk asked
    /// before the slot, and no program started around the adapter.
    #[test]
    fn the_install_is_claimed_atomically_runs_guarded_and_checks_the_disk_first() {
        let body = production();
        assert!(!body.contains(".start();"), "is_running() then start() lets a double click through");
        assert_eq!(body.matches("spawn_install(").count(), 1);
        let install = &body[body.find("pub(super) fn install(").unwrap()..];
        let install = &install[..install.find("\n}\n").unwrap()];
        let check = install.find("ensure_free_space(").expect("no disk check");
        assert!(check < install.rfind(".try_start()").unwrap(), "the slot is claimed before the disk is checked");
        assert!(install.contains("ensure_engine_at(slot, preferred_base, &venv_dir())"), "the engine comes with the first model");
        assert!(!body.contains("Command::new("), "every program starts through python_command");
        assert!(!body.contains("println!"));
        // A generation never reaches the hub.
        let generate = &body[body.find("pub(super) async fn generate(").unwrap()..];
        assert!(generate.contains(".env(\"HF_HUB_OFFLINE\", \"1\")"));
        // Nor does an enhance.
        let upscale = &body[body.find("pub(super) async fn upscale(").unwrap()..];
        assert!(upscale.contains(".env(\"HF_HUB_OFFLINE\", \"1\")"));
    }

    // ── Enhance ──────────────────────────────────────────────────────

    #[test]
    fn seedvr2_is_an_upscaler_pack_pinned_to_two_files() {
        let e = entry("seedvr2-3b");
        let pack = pack_of("seedvr2-3b");
        assert!(pack.upscales() && !pack.takes_loras() && pack.edit_images() == 0 && !pack.user_sampling());
        assert_eq!((e.repo, pack.dir, pack.family), ("numz/SeedVR2_comfyUI", "seedvr2-3b", Family::SeedVR2));
        assert_eq!(pack.family.module(), "mflux.models.seedvr2.cli.seedvr2_upscale");
        assert_eq!(pack.family.parts(), ["seedvr2_ema_3b_fp16.safetensors", "ema_vae_fp16.safetensors"]);
        // The catalogue's size is the two files the hub lists at the pin.
        let both = (6_783_018_808u64 + 501_324_814) as f64 / 1e9;
        assert!((e.size_gb as f64 - both).abs() < 0.05, "{both}");
        assert!(e.min_ram_gb >= 16, "the weights alone are 7.3 GB at fp16");
        // A permissive licence gets no sentence on the tile (macTileNotes.ts
        // marks only what a customer must know). It has run here (2x and 4x,
        // 14.10.2026), so it carries no untested sentence either.
        assert!(!e.description.contains("not yet tested"));
        // No other pack enhances, and SeedVR2 is the only upscaler.
        let upscalers: Vec<&str> = IMAGE_CATALOG.iter().filter(|c| c.mflux.is_some_and(|p| p.upscales())).map(|c| c.id).collect();
        assert_eq!(upscalers, ["seedvr2-3b"]);
    }

    #[test]
    fn the_plan_of_seedvr2_takes_the_3b_files_and_leaves_the_7b_and_fp8_copies() {
        let file = |path: &str, size: u64| RepoFile { path: path.to_string(), size, sha256: None };
        let listing = vec![
            file(".gitattributes", 1519),
            file("README.md", 41823),
            file("config.json", 0),
            file("ema_vae_fp16.safetensors", 501_324_814),
            file("seedvr2_ema_3b_fp16.safetensors", 6_783_018_808),
            file("seedvr2_ema_3b_fp8_e4m3fn.safetensors", 3_391_544_696),
            file("seedvr2_ema_7b_fp16.safetensors", 16_479_334_424),
            file("seedvr2_ema_7b_fp8_e4m3fn.safetensors", 8_239_729_704),
            file("seedvr2_ema_7b_sharp_fp16.safetensors", 16_479_334_424),
        ];
        let planned = plan(Family::SeedVR2, &listing).unwrap();
        let paths: Vec<&str> = planned.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["ema_vae_fp16.safetensors", "seedvr2_ema_3b_fp16.safetensors"]);
        assert_eq!(planned.files.iter().map(|f| f.size).sum::<u64>(), 7_284_343_622);
        // Without either file it is no pack.
        let no_vae: Vec<RepoFile> = listing.iter().filter(|f| f.path != "ema_vae_fp16.safetensors").cloned().collect();
        assert_eq!(plan(Family::SeedVR2, &no_vae).unwrap_err(), "The repository has no ema_vae_fp16.safetensors and cannot be run. Try again later.");
        let no_3b: Vec<RepoFile> = listing.iter().filter(|f| f.path != "seedvr2_ema_3b_fp16.safetensors").cloned().collect();
        assert!(plan(Family::SeedVR2, &no_3b).unwrap_err().contains("seedvr2_ema_3b_fp16.safetensors"));
    }

    #[test]
    fn the_enhance_command_line_is_the_one_the_upscaler_reads() {
        let pack = pack_of("seedvr2-3b");
        let args = strings(&upscale_args(pack, Path::new("/m/seedvr2-3b"), Path::new("/s/start-images/a.png"), 2048, Some(7), Path::new("/i/enhance-1.png"), true));
        assert_eq!(
            args,
            [
                "-m", "mflux.models.seedvr2.cli.seedvr2_upscale",
                "--model", "/m/seedvr2-3b",
                "--image-path", "/s/start-images/a.png",
                "--resolution", "2048",
                "--seed", "7",
                "--low-ram", "--no-exif",
                "--output", "/i/enhance-1.png",
            ]
        );
        // No seed: the engine's own. No flag of the picture commands, and no
        // built-in name, which would fetch from the hub instead of the folder.
        let plain = strings(&upscale_args(pack, Path::new("/m/seedvr2-3b"), Path::new("/s/a.png"), 512, None, Path::new("/i/o.png"), false));
        assert!(!plain.iter().any(|a| a == "--seed" || a == "--low-ram"));
        for flag in ["--prompt", "--steps", "--guidance", "--lora", "--base-model", "--width", "--height", "--image-paths"] {
            assert!(!plain.iter().any(|a| a.starts_with(flag)), "{flag}");
        }
        assert!(!plain.iter().any(|a| a == "seedvr2" || a == "seedvr2-3b"));
        // The run the app starts is one the orphan sweep would know as its own.
        let models = Path::new("/m");
        assert!(is_orphaned_run(&Leftover { parent: Some(1), cmd: strings(&upscale_args(pack, &models.join("seedvr2-3b"), Path::new("/s/a.png"), 512, None, Path::new("/o.png"), true)) }, models));
    }

    #[test]
    fn a_brace_in_the_output_path_survives_the_engines_format() {
        assert_eq!(output_arg(Path::new("/i/o.png")), std::ffi::OsString::from("/i/o.png"));
        assert_eq!(output_arg(Path::new("/U/a{b}/o.png")), std::ffi::OsString::from("/U/a{{b}}/o.png"));
        assert!(production().contains("args.push(output_arg(out));"));
    }

    #[test]
    fn the_size_of_an_enhance_is_the_factor_held_to_the_longest_side() {
        // (shortest side handed over, width, height of the result)
        assert_eq!(upscale_target(1024, 1024, 2), Ok((2048, 2048, 2048)));
        assert_eq!(upscale_target(1024, 1024, 4), Ok((4096, 4096, 4096)));
        assert_eq!(upscale_target(768, 512, 2), Ok((1024, 1536, 1024)));
        // A portrait at 4x would be 6144 high: held to 4096, the shape kept.
        assert_eq!(upscale_target(1024, 1536, 4), Ok((2730, 2730, 4094)));
        // An odd side comes back even, as the engine rounds it.
        assert_eq!(upscale_target(333, 500, 2), Ok((666, 666, 1000)));
        // Only the factors Create offers.
        for factor in [0, 1, 3, 8] {
            assert!(upscale_target(512, 512, factor).unwrap_err().contains("2x or 4x"), "{factor}");
        }
        // Too small, and at the limit already.
        assert!(upscale_target(16, 512, 2).unwrap_err().contains("at least 32 pixels"));
        assert!(upscale_target(4096, 2048, 2).unwrap_err().contains("up to 4096 pixels"));
        assert!(upscale_target(3000, 2000, 4).is_ok_and(|(_, w, h)| w <= MAX_UPSCALE_SIDE && h <= MAX_UPSCALE_SIDE));
    }

    #[test]
    fn only_a_staged_picture_is_enhanced() {
        let root = tempfile::tempdir().unwrap();
        let staged = root.path().join("start-images");
        put(staged.join("a.png"), 4);
        put(root.path().join("elsewhere.png"), 4);
        let path = |p: PathBuf| p.to_string_lossy().to_string();
        assert_eq!(upscale_input(&path(staged.join("a.png")), &staged).unwrap(), staged.join("a.png").canonicalize().unwrap());
        for asked in [
            path(staged.join("missing.png")),
            path(root.path().join("elsewhere.png")),
            path(staged.join("..").join("elsewhere.png")),
            path(staged.clone()),
            "relative.png".to_string(),
        ] {
            assert_eq!(upscale_input(&asked, &staged).unwrap_err(), UPSCALE_GONE, "{asked}");
        }
        assert_eq!(upscale_input(&path(staged.join("a.png")), &root.path().join("no-such-folder")).unwrap_err(), UPSCALE_GONE);
        assert_eq!(upscale_input("  ", &staged).unwrap_err(), "Add an image to enhance.");
        #[cfg(unix)]
        {
            let link = staged.join("link.png");
            std::os::unix::fs::symlink(root.path().join("elsewhere.png"), &link).unwrap();
            assert_eq!(upscale_input(&path(link), &staged).unwrap_err(), UPSCALE_GONE, "a link out of the folder");
        }
    }

    /// The order an enhance keeps, read from the source: refused before
    /// anything is unloaded, the place taken before the unload, one engine
    /// at a time, and Generate never runs the upscaler with a prompt.
    #[test]
    fn an_enhance_is_checked_claimed_and_unloaded_in_the_order_of_an_image() {
        let src = include_str!("mlx.rs");
        let from = &src[src.find("pub async fn mlx_upscale(").unwrap()..];
        let body = &from[..from.find("\n}\n").unwrap()];
        let at = |needle: &str| body.find(needle).unwrap_or_else(|| panic!("{needle} is not in mlx_upscale"));
        assert!(at("memory_verdict(") < at("mlx_unload("));
        assert!(at("image_model_is_installed(entry)") < at("mlx_unload("));
        assert!(at("mflux::request_upscale_input(") < at("mlx_unload("));
        assert!(at("sidecar_at_an_image()") < at("mflux::claim_run(req.run.clone())"));
        assert!(at("mflux::claim_run(req.run.clone())") < at("mlx_unload("));
        assert!(at("mlx_unload(") < at("mflux::upscale(entry, pack, input, factor, req.seed)"));
        let generate = &src[src.find("pub async fn mlx_generate(").unwrap()..];
        assert!(generate.find("pack.upscales()").unwrap() < generate.find("mlx_unload(").unwrap(), "Generate would run the upscaler with a prompt");
        assert!(include_str!("../main.rs").contains("commands::media_cmds::mlx_upscale,"));
        assert!(include_str!("media_cmds.rs").contains("crate::commands::mlx::mlx_upscale(state.inner(), &args).await"));
        // The catalogue says which model enhances.
        assert!(src.contains("\"upscaler\": c.mflux.is_some_and(|pack| pack.upscales()),"));
    }

    /// SeedVR2 3B on a real picture, through the command line the app builds.
    /// Run on a Mac with the two files in a folder:
    ///
    /// ```sh
    /// LU_MFLUX_PYTHON=<venv-mflux>/bin/python LU_SEEDVR2_MODEL=<folder> \
    /// LU_UPSCALE_IMAGE=<picture> [LU_UPSCALE_FACTOR=4] [LU_UPSCALE_OUT=<folder>] \
    /// cargo test upscale_on_a_real_model -- --ignored --nocapture
    /// ```
    ///
    /// It prints the time, the size and the engine's last lines, among them
    /// its peak memory.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "loads SeedVR2 3B from LU_SEEDVR2_MODEL"]
    fn upscale_on_a_real_model() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set"));
        let python = var("LU_MFLUX_PYTHON");
        let model = PathBuf::from(var("LU_SEEDVR2_MODEL"));
        let input = PathBuf::from(var("LU_UPSCALE_IMAGE"));
        let factor: u32 = std::env::var("LU_UPSCALE_FACTOR").ok().and_then(|f| f.parse().ok()).unwrap_or(2);
        for part in Family::SeedVR2.parts() {
            assert!(model.join(part).is_file(), "{} has no {part}", model.display());
        }
        let temp = tempfile::tempdir().unwrap();
        let out_dir = std::env::var("LU_UPSCALE_OUT").map(PathBuf::from).unwrap_or_else(|_| temp.path().to_path_buf());
        std::fs::create_dir_all(&out_dir).unwrap();
        let out = out_dir.join(format!("enhance-{factor}x.png"));
        let (width, height) = image::image_dimensions(&input).unwrap();
        let (resolution, want_w, want_h) = upscale_target(width, height, factor).unwrap();
        let scratch = temp.path().join("scratch");
        let started = std::time::Instant::now();
        let done = crate::python::python_command(&python)
            .args(upscale_args(&SEEDVR2_3B, &model, &input, resolution, Some(42), &out, LOW_RAM))
            .env("HF_HUB_OFFLINE", "1")
            .env("HF_HOME", scratch.join(".hf-cache"))
            .env("MFLUX_CACHE_DIR", scratch.join(".mflux-cache"))
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::null())
            .output()
            .unwrap();
        let took = started.elapsed();
        let said = format!("{}\n{}", String::from_utf8_lossy(&done.stdout), String::from_utf8_lossy(&done.stderr));
        let tail: Vec<&str> = said.lines().filter(|l| !l.trim().is_empty()).collect();
        println!("{}", tail[tail.len().saturating_sub(15)..].join("\n"));
        assert!(done.status.success(), "the engine ended with {}", done.status);
        let made = png_size(&out).expect("the engine wrote no PNG");
        println!(
            "enhance {} {width}x{height} at {factor}x -> {}x{} in {:.1} s",
            out.display(),
            made.0,
            made.1,
            took.as_secs_f64()
        );
        assert_eq!(made, (want_w, want_h), "the size the app reports is the size the engine made");
    }
}
