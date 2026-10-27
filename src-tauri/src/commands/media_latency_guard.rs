//! Guards for the latency of the Mac media lanes.
//!
//! The owner's M5 Pro, 08.10.2026: the Model Manager took five to six seconds
//! to open, a Get took as long before it started, and a Stop took longer
//! still. One command was behind all three. `video_status` asked an
//! interpreter to `import mlx_video` (5.2 s measured), on the thread that
//! draws the window, and the interface asked for that status when the page
//! opened, before an install, and again after every change of an install
//! slot. Proof and numbers: `proof/mac/LATENZ-MODEL-MANAGER.md`.
//!
//! What is pinned here is the rule that came out of it: a command the
//! interface waits on reads files and memory. It starts no interpreter and
//! asks no network. Those belong to the install thread, behind the answer.

use crate::state::AppState;
use serde_json::{json, Value};

/// The video engine as pip leaves it, in the scratch storage of this test
/// process: an interpreter path and the dist-info record. With it there, the
/// status takes the very path that used to start Python.
fn fake_video_engine() -> std::path::PathBuf {
    let venv = crate::os_paths::data_dir().join("mlx-video").join("venv");
    assert!(venv.starts_with(crate::os_paths::test_storage::root()), "the test would write into the real app data");
    let record = venv.join("lib/python3.12/site-packages/mlx_video-9.9.9.dist-info");
    std::fs::create_dir_all(&record).unwrap();
    std::fs::create_dir_all(venv.join("bin")).unwrap();
    std::fs::write(record.join("METADATA"), "Metadata-Version: 2.4\nName: mlx-video\nVersion: 9.9.9\n\nVersion: not this one\n").unwrap();
    // Not a program. A command that tried to start it would fail, and the
    // counter below would have counted the attempt first.
    std::fs::write(venv.join("bin/python"), b"").unwrap();
    venv
}

#[test]
fn status_and_list_commands_start_no_interpreter_and_ask_no_network() {
    let venv = fake_video_engine();
    // Never dropped: dropping an AppState sweeps the port of the image
    // sidecar, and on a developer's Mac that can be the real one.
    let state = std::mem::ManuallyDrop::new(AppState::new());
    let none = json!({});
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let interpreters = super::interpreter_commands_built();
    let requests = super::hub_requests_sent();

    let video = super::video::video_status(&state, &none).unwrap();
    let answers: Vec<(&str, Value)> = vec![
        ("mlx_status", runtime.block_on(super::mlx::mlx_status(&state, &none)).unwrap()),
        ("mlx_image_models", super::mlx::mlx_image_models(&state, &none).unwrap()),
        ("video_list_models", super::video::video_list_models(&state, &none).unwrap()),
        ("mlx_image_install_status", super::mlx::mlx_image_install_status(&state, &none).unwrap()),
        ("install_mlx_diffusion_status", super::mlx::install_mlx_diffusion_status(&state, &none).unwrap()),
        ("video_install_mlx_status", super::video::video_install_mlx_status(&state, &none).unwrap()),
        ("video_install_model_status", super::video::video_install_model_status(&state, &none).unwrap()),
        ("video_progress", super::video::video_progress(&state, &none).unwrap()),
        ("mlx_generate_progress", super::mlx::mlx_generate_progress(&state, &none).unwrap()),
        // A Stop with nothing to stop, which is also what a second click is.
        ("mlx_image_cancel_install", super::mlx::mlx_image_cancel_install(&state, &none).unwrap()),
        ("video_cancel_model_install", super::video::video_cancel_model_install(&state, &none).unwrap()),
    ];
    let _ = std::fs::remove_dir_all(&venv);

    assert_eq!(
        super::interpreter_commands_built(),
        interpreters,
        "a status or list command built an interpreter command. That is a tenth of a second at best and five with an import, every time the page opens."
    );
    assert_eq!(super::hub_requests_sent(), requests, "a status or list command asked the hub");
    // They did answer, and the video status answered from the record on disk.
    assert_eq!(answers.len(), 11);
    assert!(answers.iter().all(|(_, v)| !v.is_null()));
    assert_eq!(video["mlxInstalled"], true, "the record pip left was not read");
    assert_eq!(video["mlxVersion"], "9.9.9");

    // COUNTER-CHECK: the counter does count, or the assertion above is empty.
    let _ = crate::python::python_command("python3");
    assert_eq!(super::interpreter_commands_built(), interpreters + 1);
    super::note_hub_request();
    assert_eq!(super::hub_requests_sent(), requests + 1);
}

/// The text of one function: from its signature to the next line that starts
/// a new item at the same depth.
fn body<'a>(source: &'a str, signature: &str) -> &'a str {
    let from = source.find(signature).unwrap_or_else(|| panic!("{signature} is gone"));
    let rest = &source[from..];
    &rest[..rest.find("\n}\n").expect("the end of the function") + 3]
}

#[test]
fn a_click_is_answered_before_anything_slow_starts() {
    let production = |source: &'static str| &source[..source.find("#[cfg(test)]\nmod tests").expect("the test module")];
    let mlx = production(include_str!("mlx.rs"));
    let video = production(include_str!("video.rs"));
    let mflux = production(include_str!("image_mflux.rs"));
    // What a command may not do on the way to its answer. Each of these has a
    // place: the thread `spawn_install` starts.
    let slow = [
        "hub_get(", "fetch_repo_revision(", "fetch_repo_listing(", "fetch_model_index(", "reqwest::",
        "python_command(", "python_has_module(", "mlx_video_imports(", "interpreter_fits(", "venv_python_fits(", "python_version(",
        "locate_base_python(", "locate_engine_python(", "ensure_python_module(", "run_streamed(", "run_hub_step(",
    ];
    let commands = [
        ("mlx_image_install_model", body(mlx, "pub fn mlx_image_install_model(")),
        ("install_mlx_diffusion", body(mlx, "pub fn install_mlx_diffusion(")),
        ("mlx_image_cancel_install", body(mlx, "pub fn mlx_image_cancel_install(")),
        ("mlx_image_delete_model", body(mlx, "pub fn mlx_image_delete_model(")),
        ("mlx_image_models", body(mlx, "pub fn mlx_image_models(")),
        ("mflux install", body(mflux, "pub(super) fn install(")),
        ("video_status", body(video, "pub fn video_status(")),
        ("video_list_models", body(video, "pub fn video_list_models(")),
        ("video_install_mlx", body(video, "pub fn video_install_mlx(")),
        ("video_install_model", body(video, "pub fn video_install_model(")),
        ("video_cancel_model_install", body(video, "pub fn video_cancel_model_install(")),
        ("video_delete_model", body(video, "pub fn video_delete_model(")),
        // What the status commands lean on.
        ("mlx_video_version", body(video, "fn mlx_video_version(")),
        ("mlx_video_installed", body(video, "fn mlx_video_installed(")),
        ("dist_version", body(video, "fn dist_version(")),
        ("image_model_is_installed", body(mlx, "fn image_model_is_installed(")),
        ("engine_state", body(mlx, "fn engine_state(")),
    ];
    for (name, text) in commands {
        for call in slow {
            assert!(!text.contains(call), "{name} calls {call} before it answers. That belongs on the install thread.");
        }
    }
    // And where the requests of an install are: behind `spawn_install`, each
    // with a line in the log before it goes out.
    let install = body(mlx, "fn install_image_model(");
    assert!(install.find("slot.log(format!(\"asking the hub what {} holds\"").unwrap() < install.find("fetch_repo_revision(").unwrap());
    let steps = body(mflux, "fn install_steps(");
    assert!(steps.find("slot.log(format!(\"asking the hub what {} holds\"").unwrap() < steps.find("fetch_repo_listing(").unwrap());
    // Every request to the hub goes through the one function that counts.
    assert!(body(mlx, "fn hub_get(").contains("crate::commands::note_hub_request();"));
    assert!(include_str!("../python.rs").contains("-> Command {\n    crate::commands::note_interpreter_command();"));
    assert_eq!(mlx.matches("reqwest::blocking::Client").count(), 1, "a second way to the hub that nothing counts");
    let command = body(mlx, "pub fn mlx_image_install_model(");
    assert!(command.contains("spawn_install(slot, move |slot| install_image_model(slot, &entry2))"));
}
