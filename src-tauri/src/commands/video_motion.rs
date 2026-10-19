//! Motion Control on the Mac: an LTX-2.3 pack of the second engine with the
//! IC-LoRA "Union Control" of Lightricks. A motion video and a start image go
//! in, and the video that comes out moves the way the motion video does.
//!
//! A child module of `commands::video`, as `ltx2mlx` is. Every statement about
//! the engine below was read from its source at the pinned commit (v0.16.2,
//! `ltx_pipelines_mlx/cli.py`, `ic_lora.py`, `iclora_utils.py`,
//! `utils/media_io.py`, `ltx_core_mlx/utils/ffmpeg.py`), 15.10.2026:
//!
//!   - `ic-lora` is a subcommand of its own. It takes the generation flags of
//!     `generate` (`--model`, `--gemma`, `--output`, `-W`, `-H`, `--frames`,
//!     `--frame-rate`, `--low-ram`, `--seed`, `--image`), plus
//!     `--lora PATH STRENGTH` and `--video-conditioning PATH STRENGTH`.
//!   - Without `--dev-transformer` it loads the distilled transformer every
//!     pack has. Dev mode would load the dev transformer and fuse the distilled
//!     LoRA (7.6 GB) on top, which no distilled pack ships.
//!   - The LoRA was trained on Canny, depth and pose maps, not on footage. It
//!     reads the control as it is given, so the motion video is turned into
//!     an edge map first (`control_filter`). Edges are the one of the three
//!     that ffmpeg makes alone: depth and pose need a model of their own.
//!   - Its reference is read at half the size of the video (the
//!     `reference_downscale_factor` of 2 in the file's metadata), and the
//!     engine resizes the control itself.
//!   - `--upsample-only --refine-steps 3`: the half size pass, the upsampler,
//!     and three refine steps with the LoRA kept fused and the control read
//!     again at full size. The plain two stage run reloads a clean
//!     transformer for its second stage (a second load of 11 GB) and drifts
//!     off the control there.
//!   - The engine reads the length and size of a control video through
//!     `ffprobe`, which the `imageio-ffmpeg` of the venv does not bring.
//!     `BOOT` answers that question from `imageio_ffmpeg` instead.

use super::{ltx2mlx, models_root, CatalogEntry};
use std::path::{Path, PathBuf};
use std::process::Command;

/// The id the install and the delete of the LoRA go by. It is no entry of
/// the catalogue: it runs on the packs, and has no tile of its own.
pub(super) const ID: &str = "ltx-2.3-motion-control";
pub(super) const NAME: &str = "Motion Control for LTX-2.3";
/// Public and ungated (hub API, 14.10.2026).
pub(super) const REPO: &str = "Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control";
pub(super) const FILE: &str = "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors";
/// The size of `FILE` in bytes. A file of another size is a download that
/// did not finish.
pub(super) const SIZE_BYTES: u64 = 654_465_352;

/// What follows `python -c BOOT <motion video> <control video> <filter> <frames>`.
pub(super) const CLI: [&str; 2] = [ltx2mlx::MODULE, "ic-lora"];

/// The LoRA at full strength, and the control at full strength.
const STRENGTH: &str = "1.0";

/// The refine steps after the upsampler. Three is the length of the engine's
/// own second stage (`STAGE_2_SIGMAS`).
const REFINE_STEPS: &str = "3";

/// Beside the text encoders, in the models folder of the app.
pub(super) fn dir() -> PathBuf {
    models_root().join("_ic-lora").join(REPO.replace('/', "--"))
}

pub(super) fn lora_path() -> PathBuf {
    dir().join(FILE)
}

/// Whether the LoRA is on disk, whole.
pub(super) fn installed() -> bool {
    lora_path().metadata().is_ok_and(|m| m.is_file() && m.len() == SIZE_BYTES)
}

/// Whether a run of this model can follow a motion video: the LTX-2.3 packs
/// of the second engine, which is what the LoRA was trained on. LTX-2.5 is
/// another model, and the first engine has no `ic-lora`.
pub(super) fn takes_motion(c: &CatalogEntry) -> bool {
    c.family == ltx2mlx::FAMILY && (c.repo_files == ltx2mlx::PACK_23 || c.repo_files == ltx2mlx::PACK_23_V11)
}

/// The sentence a motion run is refused with before anything loads, or
/// `None` when it can run.
pub(super) fn refusal(entry: &CatalogEntry, lora_installed: bool, motion_video: &Path) -> Option<String> {
    if !takes_motion(entry) {
        return Some(format!("{} cannot follow a motion video. Pick an LTX-2.3 model for Motion Control.", entry.name));
    }
    if !lora_installed {
        return Some("Motion Control is not installed yet. Install it from the Motion Control tab, then start again.".to_string());
    }
    if !motion_video.is_file() {
        return Some(format!("motion_video not found: {}. Add the motion video again.", motion_video.display()));
    }
    None
}

/// The ffmpeg filter that turns the motion video into the control: the rate
/// of the run, the size of the run (filled and cut to its shape, as the
/// engine does with the start image), edges white on black, and the last
/// frame held where the motion video is shorter than the run.
pub(super) fn control_filter(width: u32, height: u32) -> String {
    format!(
        "fps={rate},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=gray,edgedetect=low=0.1:high=0.3,format=yuv420p,tpad=stop_mode=clone:stop=-1",
        rate = ltx2mlx::FRAME_RATE
    )
}

/// Where the control of a job is written: beside the videos, in a folder of
/// its own, so it is never taken for a result.
pub(super) fn control_path(outputs: &Path, job_id: &str) -> PathBuf {
    outputs.join("motion-control").join(format!("{job_id}.mp4"))
}

/// The Python a motion run starts with. It makes the control with the ffmpeg
/// of the venv, answers the engine's two `ffprobe` questions from
/// `imageio_ffmpeg`, and then runs the module named after the four values,
/// as `python -m` would (the same way as `CAPPED_CACHE_BOOT`).
pub(super) const BOOT: &str = r#"import runpy, subprocess, sys
from imageio_ffmpeg import count_frames_and_secs, get_ffmpeg_exe, read_frames
source, control, vf, frames = sys.argv[1:5]
print('Preparing the motion video', flush=True)
made = subprocess.run([get_ffmpeg_exe(), '-v', 'error', '-nostdin', '-y', '-i', source, '-an', '-vf', vf,
    '-frames:v', frames, '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', control])
if made.returncode != 0:
    sys.exit('The motion video could not be read. Use an MP4, MOV or WebM file.')
from ltx_core_mlx.utils.ffmpeg import VideoInfo
import ltx_pipelines_mlx.iclora_utils as iclora_utils
import ltx_pipelines_mlx.utils.media_io as media_io
def probe(path):
    reader = read_frames(str(path))
    meta = next(reader)
    reader.close()
    count, secs = count_frames_and_secs(str(path))
    width, height = meta['size']
    return VideoInfo(width=width, height=height, num_frames=count, fps=float(meta['fps']), duration=secs, has_audio=False)
iclora_utils.probe_video_info = probe
media_io.probe_video_info = probe
sys.argv = sys.argv[5:]
runpy.run_module(sys.argv[0], run_name='__main__', alter_sys=True)
"#;

/// The arguments after `-c BOOT`: the four values `BOOT` reads, then the
/// module and its subcommand.
pub(super) fn boot_args(cmd: &mut Command, motion_video: &Path, control: &Path, size: (u32, u32), frames: u32) {
    cmd.arg(motion_video.as_os_str())
        .arg(control.as_os_str())
        .arg(control_filter(size.0, size.1))
        .arg(frames.to_string())
        .args(CLI);
}

/// The flags of the LoRA and the control. They go before the user's LoRA
/// stack and the start image: `--image` takes one or more values and has to
/// stay the last flag.
///
/// `LTX2_LORA_MODE=unfused`: the LoRA is attached to the resident 4-bit
/// transformer as an adapter. Fused, which is the engine's default, every
/// layer it touches is taken out of 4 bit, added to and quantized again, and
/// on the M5 Pro with 48 GB the free memory fell from 74 to 32 percent within
/// fifteen seconds of loading (real run, 15.10.2026, stopped there). Under
/// `--low-ram`, which `video_generate` passes for every motion run, the engine
/// fuses block by block and ignores the setting; it holds for a resident
/// transformer should that ever be passed again.
pub(super) fn motion_args(cmd: &mut Command, lora: &Path, control: &Path) {
    cmd.env("LTX2_LORA_MODE", "unfused");
    cmd.arg("--lora")
        .arg(lora.as_os_str())
        .arg(STRENGTH)
        .arg("--video-conditioning")
        .arg(control.as_os_str())
        .arg(STRENGTH)
        .arg("--upsample-only")
        .arg("--refine-steps")
        .arg(REFINE_STEPS);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_of(cmd: &Command) -> Vec<String> {
        cmd.get_args().map(|a| a.to_string_lossy().to_string()).collect()
    }

    #[test]
    fn the_command_line_is_the_one_the_engine_reads() {
        assert_eq!(CLI, ["ltx_pipelines_mlx", "ic-lora"]);
        let mut cmd = Command::new("python");
        boot_args(&mut cmd, Path::new("/v/dance.mp4"), Path::new("/v/motion-control/j.mp4"), (512, 512), 41);
        motion_args(&mut cmd, Path::new("/m/_ic-lora/u.safetensors"), Path::new("/v/motion-control/j.mp4"));
        assert_eq!(
            args_of(&cmd),
            [
                "/v/dance.mp4", "/v/motion-control/j.mp4", &control_filter(512, 512), "41", "ltx_pipelines_mlx", "ic-lora",
                "--lora", "/m/_ic-lora/u.safetensors", "1.0", "--video-conditioning", "/v/motion-control/j.mp4", "1.0",
                "--upsample-only", "--refine-steps", "3",
            ]
        );
        let mode = cmd.get_envs().find(|(k, _)| *k == "LTX2_LORA_MODE").and_then(|(_, v)| v);
        assert_eq!(mode.and_then(|v| v.to_str()), Some("unfused"));
    }

    #[test]
    fn the_control_is_an_edge_map_at_the_rate_and_size_of_the_run() {
        let vf = control_filter(768, 512);
        assert!(vf.starts_with("fps=24,scale=768:512:force_original_aspect_ratio=increase,crop=768:512,"), "{vf}");
        // Edges of the brightness alone: on the colour planes they draw a second outline.
        assert!(vf.contains("format=gray,edgedetect="), "{vf}");
        // A motion video shorter than the run holds its last frame.
        assert!(vf.ends_with("tpad=stop_mode=clone:stop=-1"), "{vf}");
    }

    #[test]
    fn the_boot_reads_four_values_and_then_runs_the_module_like_dash_m() {
        assert!(BOOT.contains("source, control, vf, frames = sys.argv[1:5]"));
        assert!(BOOT.contains("sys.argv = sys.argv[5:]"));
        assert!(BOOT.contains("runpy.run_module(sys.argv[0], run_name='__main__', alter_sys=True)"));
        // Both places that ask ffprobe get the answer from imageio_ffmpeg.
        assert!(BOOT.contains("iclora_utils.probe_video_info = probe") && BOOT.contains("media_io.probe_video_info = probe"));
        // The control is made by the ffmpeg of the venv, not one on the PATH.
        assert!(BOOT.contains("get_ffmpeg_exe()"));
    }

    #[test]
    fn only_the_ltx_2_3_packs_of_the_second_engine_follow_a_motion_video() {
        let q4 = super::super::catalog_lookup("ltx-2.3-q4").unwrap();
        assert!(takes_motion(q4));
        assert!(!takes_motion(super::super::catalog_lookup("ltx-2.5-q4").unwrap()));
        assert!(!takes_motion(super::super::catalog_lookup("ltx-2.3-distilled").unwrap()));
        assert!(!takes_motion(super::super::catalog_lookup("wan21-t2v-1.3b").unwrap()));
        let dir = tempfile::tempdir().unwrap();
        let clip = dir.path().join("dance.mp4");
        assert!(refusal(q4, false, &clip).unwrap().contains("not installed"));
        assert!(refusal(q4, true, &clip).unwrap().contains("motion_video not found"));
        std::fs::write(&clip, b"x").unwrap();
        assert_eq!(refusal(q4, true, &clip), None);
        assert!(refusal(super::super::catalog_lookup("ltx-2.5-q4").unwrap(), true, &clip).unwrap().contains("LTX-2.3"));
    }

    #[test]
    fn a_motion_run_always_streams_the_transformer() {
        let source = include_str!("video.rs");
        let generate = &source[source.find("pub fn video_generate(").unwrap()..source.find("pub fn video_progress(").unwrap()];
        // A talking run streams as well (Talking Character, video_ltx2mlx.rs).
        assert!(generate.contains("let low_ram = talking\n            || control.is_some()\n            || ltx2mlx::wants_low_ram("));
        assert!(generate.contains("motion::refusal(entry, motion::installed(), v)"));
    }

    #[test]
    fn the_lora_counts_as_installed_only_whole() {
        assert!(dir().starts_with(models_root()) && dir().ends_with("_ic-lora/Lightricks--LTX-2.3-22b-IC-LoRA-Union-Control"));
        assert_eq!(control_path(Path::new("/v"), "j"), PathBuf::from("/v/motion-control/j.mp4"));
    }
}
