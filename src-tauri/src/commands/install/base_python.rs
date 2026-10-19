//! Which Python a new venv is built from: one this machine already has, or,
//! when none of them fits, LU's own.
//!
//! ComfyUI (Install, Repair environment) and the character trainer each
//! decide for themselves which interpreters on the machine they can use: the
//! first asks the live PyTorch index which versions it serves, the second
//! has musubi's fixed range and, on Windows, a 64-bit x86 build. What
//! happens when nothing on the machine fits used to differ: ComfyUI stopped
//! with "Reinstall a supported Python version", the trainer ran winget on
//! Windows and stopped everywhere else (Discord 14.10.2026: a machine whose
//! only Python was 3.15 could neither install nor repair ComfyUI after the
//! update).
//!
//! The answer is now the same for both and lives here: LU's own Python
//! ([`crate::private_python`], python-build-standalone 3.12, pinned by
//! sha256, unpacked into LU's data folder without administrator rights).
//! The Pythons already on the machine are never touched, and one that fits
//! always keeps its place before LU's own.

use crate::private_python::{self, Progress, Why};

/// Where the base interpreter comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Base {
    /// An interpreter this machine already has.
    Machine(String),
    /// LU's own Python, this version.
    Own((u32, u32)),
    /// Nothing on the machine fits, and LU's own Python does not either (or
    /// LU has none for this system).
    Missing,
}

/// The pure decision. `machine` is what the caller's own picker found on the
/// machine (None when nothing fit), `own` the version of LU's own Python for
/// this system (None when the pin has no build for it), `accepts` the
/// caller's own version rule, applied to LU's Python the same way it was to
/// every other one.
pub(crate) fn decide(machine: Option<String>, own: Option<(u32, u32)>, accepts: impl Fn((u32, u32)) -> bool) -> Base {
    match (machine, own) {
        (Some(path), _) => Base::Machine(path),
        (None, Some(v)) if accepts(v) => Base::Own(v),
        (None, _) => Base::Missing,
    }
}

/// ComfyUI's reason, for the log line and the failure sentence of the
/// download.
pub(crate) const FOR_PYTORCH: Why<'static> = Why {
    log: "no Python on this computer has a PyTorch wheel for this machine",
    sentence: "No Python on this computer has a PyTorch wheel for this machine",
};

/// The trainer's reason.
pub(crate) const FOR_TRAINER: Why<'static> = Why {
    log: "no Python 3.10, 3.11 or 3.12 on this computer for the trainer",
    sentence: "This computer has no Python 3.10, 3.11 or 3.12 for the trainer",
};

/// The one function ComfyUI and the trainer both go through: the machine's
/// pick when there is one, otherwise LU's own Python, downloaded on the spot
/// when it is not there yet (a finished one is reused without a download).
///
/// `Ok(None)`: neither is available, the caller says why in its own words.
/// `Err`: LU's own Python was needed and could not be set up; the sentence
/// is ready to show. `Err("cancelled")` is a Stop during the download.
pub(crate) fn machine_or_own(
    machine: Option<String>,
    accepts: impl Fn((u32, u32)) -> bool,
    progress: &dyn Progress,
    why: Why<'_>,
) -> Result<Option<String>, String> {
    match decide(machine, private_python::version_here(), accepts) {
        Base::Machine(path) => Ok(Some(path)),
        Base::Own(_) => private_python::ensure_for(progress, why).map(|exe| Some(exe.to_string_lossy().into_owned())),
        Base::Missing => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn torch_serves(v: (u32, u32)) -> bool {
        (10..=13).contains(&v.1) && v.0 == 3
    }

    #[test]
    fn a_python_of_the_machine_always_comes_first() {
        let found = decide(Some("C:\\Python312\\python.exe".to_string()), Some((3, 12)), torch_serves);
        assert_eq!(found, Base::Machine("C:\\Python312\\python.exe".to_string()));
    }

    #[test]
    fn nothing_on_the_machine_fits_so_lu_takes_its_own() {
        // The Discord case: only 3.15 here, the caller's picker found nothing.
        assert_eq!(decide(None, Some((3, 12)), torch_serves), Base::Own((3, 12)));
    }

    #[test]
    fn lus_own_python_has_to_pass_the_same_rule() {
        // An index that one day stops serving 3.12 must not get LU's Python
        // handed to it anyway.
        assert_eq!(decide(None, Some((3, 12)), |v| v == (3, 13)), Base::Missing);
    }

    #[test]
    fn a_system_without_a_pinned_build_ends_as_missing() {
        assert_eq!(decide(None, None, torch_serves), Base::Missing);
    }

    #[test]
    fn the_pin_names_3_12_wherever_it_has_a_build() {
        // The three systems the pin carries; elsewhere there is no own Python.
        let here = private_python::version_here();
        let pinned = matches!(
            (std::env::consts::OS, std::env::consts::ARCH),
            ("macos", "aarch64") | ("windows", "x86_64") | ("linux", "x86_64")
        );
        assert_eq!(here.is_some(), pinned, "{here:?}");
        if pinned {
            assert_eq!(here, Some((3, 12)));
        }
    }

    /// The Discord case from end to end, on a real machine: Python 3.15 is
    /// LU's default, the live PyTorch index for this machine's card has no
    /// wheel for it, LU sets up its own Python, builds ComfyUI's venv from
    /// it, installs PyTorch (the CPU build, to keep the download small) and
    /// ComfyUI's requirements, and ComfyUI starts out of that venv. Then a
    /// second checkout WITHOUT a venv is bound to the interpreter that holds
    /// torch, not to 3.15, and starts as well.
    ///
    /// The machine scan is replaced by a list that holds only the 3.15: a
    /// test machine has other Pythons, and they must neither be hidden nor
    /// used here. Downloads LU's Python (about 22 MB), PyTorch for the CPU
    /// and ComfyUI, so it only runs when asked:
    /// `LU_BOX_PY315=<python 3.15> LU_BOX_DIR=<empty folder> cargo test only_python_3_15 -- --ignored --nocapture`
    #[test]
    #[ignore = "downloads Python, PyTorch and ComfyUI, see LU_BOX_PY315"]
    fn a_machine_with_only_python_3_15_gets_a_comfyui_that_starts() {
        use crate::commands::install::pip::pip_install_streaming_with_retry_cancellable;
        use crate::commands::install::{create_comfyui_venv, plan_pytorch_install, pytorch_pip_args};
        use crate::commands::install::torch::{base_for_new_venv, decide_torch_python_for_box, python_version_tuple};
        use std::path::{Path, PathBuf};
        use std::sync::atomic::AtomicBool;
        use std::sync::{Arc, Mutex};

        let py315 = std::env::var("LU_BOX_PY315").expect("LU_BOX_PY315 names a Python 3.15");
        let work = PathBuf::from(std::env::var("LU_BOX_DIR").expect("LU_BOX_DIR names a working folder"));
        std::fs::create_dir_all(&work).unwrap();
        let v315 = python_version_tuple(&py315).expect("the 3.15 answers");
        assert_eq!(v315, (3, 15));

        // 1. The decision, against the live index of this machine's card.
        let (_args, gpu_info, index, packages) = plan_pytorch_install();
        println!("[box] card: {gpu_info}; index {index:?}");
        let refs: Vec<&str> = packages.iter().map(String::as_str).collect();
        let decision = decide_torch_python_for_box(&py315, v315, index.as_deref(), &refs);
        let status = Arc::new(Mutex::new(crate::state::InstallState::default()));
        let cancel = Arc::new(AtomicBool::new(false));
        let progress = crate::private_python::StatusProgress { status: &status, cancel: &cancel };
        let base = base_for_new_venv(decision, &py315, &progress, &|line| println!("[box] {line}")).expect("a base Python");
        println!("[box] base Python: {base}");
        for line in &status.lock().unwrap().logs {
            println!("[box] log: {line}");
        }
        assert!(Path::new(&base).starts_with(crate::os_paths::data_dir().join("python")), "LU's own Python, not one of the machine's: {base}");
        assert_eq!(python_version_tuple(&base), Some((3, 12)));

        // 2. ComfyUI, its venv from that Python, PyTorch and the requirements.
        let comfy = work.join("ComfyUI");
        if !comfy.join("main.py").is_file() {
            let ok = crate::process_util::foreign_system_command("git")
                .args(["clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI"])
                .arg(&comfy)
                .status()
                .unwrap()
                .success();
            assert!(ok, "git clone");
        }
        let venv_py = create_comfyui_venv(&comfy, &base, None).expect("venv from LU's own Python");
        let venv_py = venv_py.to_string_lossy().to_string();
        println!("[box] venv: {venv_py}");
        let torch_args = pytorch_pip_args(Some("https://download.pytorch.org/whl/cpu"), crate::commands::torch_wheels::TORCH_TRIO);
        let torch_refs: Vec<&str> = torch_args.iter().map(String::as_str).collect();
        pip_install_streaming_with_retry_cancellable(&torch_refs, &venv_py, 2, &status, None).expect("PyTorch into the venv");
        let reqs = comfy.join("requirements.txt").to_string_lossy().to_string();
        pip_install_streaming_with_retry_cancellable(&["-m", "pip", "install", "--no-input", "-r", &reqs], &venv_py, 2, &status, None)
            .expect("ComfyUI requirements");

        // 3. The start takes the venv.
        let venv_state = crate::python::comfy_venv_state(&comfy);
        let chosen = crate::commands::process::launch_python(None, &venv_state, &comfy, || panic!("a venv start scanned the machine")).unwrap();
        assert_eq!(chosen, venv_py);
        let starts = |python: &str, dir: &Path| {
            let out = crate::python::python_command(python)
                .args(["main.py", "--cpu", "--quick-test-for-ci"])
                .current_dir(dir)
                .output()
                .unwrap();
            let tail: String = String::from_utf8_lossy(&out.stderr).lines().rev().take(6).collect::<Vec<_>>().join(" | ");
            println!("[box] start {} in {}: {:?} {tail}", python, dir.display(), out.status.code());
            out.status.success()
        };
        assert!(starts(&chosen, &comfy), "ComfyUI starts out of the venv built from LU's own Python");

        // 4. A checkout without a venv: bound to the Python that holds torch.
        let bare = work.join("ComfyUI-novenv");
        if !bare.join("main.py").is_file() {
            let ok = crate::process_util::foreign_system_command("git")
                .args(["clone", "--quiet"])
                .arg(&comfy)
                .arg(&bare)
                .status()
                .unwrap()
                .success();
            assert!(ok, "local clone");
        }
        assert_eq!(crate::python::comfy_venv_state(&bare), crate::python::ComfyVenv::Absent);
        let config = work.join("config.json");
        let bound = crate::commands::process::launch_python(None, &crate::python::ComfyVenv::Absent, &bare, || {
            let saved = crate::commands::process::remembered_bound_python_in(&config, &bare);
            let pick = crate::commands::process::pick_torch_python(
                saved.as_deref(),
                &py315,
                || vec![py315.clone(), venv_py.clone()],
                |p| crate::commands::process::python_prefix_has_torch(Path::new(p)),
                crate::commands::install::python_finds_torch,
            )?;
            crate::commands::process::remember_bound_python_in(&config, &bare, &pick);
            Some(pick)
        })
        .unwrap();
        println!("[box] bound: {bound}");
        assert_eq!(bound, venv_py, "the 3.15 default has no torch, the Python that holds it is taken");
        assert_eq!(crate::commands::process::remembered_bound_python_in(&config, &bare).as_deref(), Some(venv_py.as_str()));
        assert!(starts(&bound, &bare), "the checkout without a venv starts on the bound Python");
        // And the default alone would not have: 3.15 has no torch.
        assert!(!crate::commands::install::python_finds_torch(&py315));
    }

}
