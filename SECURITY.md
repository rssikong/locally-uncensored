# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use one of these, in this order:

1. **GitHub private vulnerability reporting:** [open a draft advisory](https://github.com/PurpleDoubleD/locally-uncensored/security/advisories/new). Only the maintainers see it, and the fix, the advisory and a CVE can be prepared in the same place.
2. **Email:** hello@lu-labs.ai with "Security" in the subject. Say if you want to send an encrypted report and we agree on a way first.
3. **Discord:** a direct message on the [Discord](https://locallyuncensored.com/discord), if neither of the above works for you.

Please include what is affected (version, platform, feature), the steps to reproduce, what an attacker gains, and a fix if you have one.

## What happens next

| Step | Target |
|---|---|
| We confirm that the report arrived | within 48 hours |
| We tell you whether we accept it and how severe we rate it | within 7 days |
| Fix released for a critical or high issue | within 14 days of accepting it |
| Fix released for a medium or low issue | in one of the next regular releases |

Locally Uncensored is maintained by a small team, so these are targets, not a contract; when one slips we say so in the report thread. We disclose in coordination with you: the advisory is published once the fix is out, at the latest 90 days after the report, and you are credited unless you ask us not to.

## Supported versions

| Version | Security fixes |
|---|---|
| Latest release (see [Releases](https://github.com/PurpleDoubleD/locally-uncensored/releases/latest)) | Yes |
| Any older release | No, the fix is the update |

The app looks for a new version shortly after start and at most every six hours after that. **Settings → Updates** shows the installed version and what it found.

## In scope

The desktop app (Windows, macOS, Linux) built from this repository, the phone app's connection to it, and the release and update path:

- **Chat and agent output:** model output or a fetched page that runs script in the app (XSS), or makes a tool run without the confirmation the app promises
- **File access:** path traversal or writes outside the folders a feature is meant to touch
- **Local bridges and APIs:** the ComfyUI bridge, the LU Engine and the local API answering a web page or another user on the machine when they should not, or running commands nobody asked for
- **Remote Access:** auth bypass, pairing code or passcode brute force, chat dispatch by an unpaired device, over the home network or the Cloudflare tunnel
- **Computer control and Voice:** an action without the promised confirmation, a way around the apps that are off limits, audio that leaves the device in local mode
- **Release and update:** an update accepted that was not built and signed by this repository's release workflow
- **Dependencies:** a known vulnerability in an npm, Cargo or Python package we ship that is reachable in the app

## Out of scope

- Vulnerabilities in Ollama, ComfyUI, LM Studio or other backends themselves (please report them to their maintainers)
- The hosted LU Cloud service at lu-labs.ai (report those to hello@lu-labs.ai as well, but they are not covered by this repository's advisories)
- Attacks that need physical access to an unlocked machine or an account that already has admin rights
- Social engineering, spam, denial of service through sheer volume
- Antivirus false positives (see below)

## What we check before every release

Every push to `master` and every release runs the same gate (`.github/workflows/ci.yml`): lint, type check, unit and end-to-end tests, Rust tests and Clippy, and a dependency audit (`npm audit` for the shipped packages, `cargo deny` and `cargo audit` for the Rust crates, accepted advisories listed with their reason in `src-tauri/deny.toml`). CodeQL scans the TypeScript, Rust, Python and workflow code (`.github/workflows/codeql.yml`), and the [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/PurpleDoubleD/locally-uncensored) rates the repository's own practices. From 3.0.8 on, each release carries CycloneDX SBOMs and a `SHA256SUMS.txt`. Every updater bundle is signed (key below).

**There has not been an independent security audit yet.** One is planned, and this file will link the report when it exists. What the project does and where data goes is described on the [Security page](https://locallyuncensored.com/security/).

The changes that harden each release are in the Security section of the [CHANGELOG](CHANGELOG.md).

---

## Antivirus & Browser False Positives

Some antivirus engines and browser SmartScreen prompts flag the Windows installer as suspicious or as a generic trojan. This is a **false positive** caused by heuristics, not actual malware. Reports we have seen so far:

- **ESET**: blocks the installer at run-time
- **Avast**: `Win32:NSIS_Error[Heur]` heuristic on the NSIS bootstrap
- **Microsoft SmartScreen**: "unrecognized app" warning on first run

### Why it happens

1. **The installer is not yet Authenticode-signed.** We sign the auto-update channel with a Tauri / minisign key (see below), but the NSIS `.exe` you download from GitHub Releases does not yet carry a Microsoft code-signing certificate. Without that certificate, every reputation-based heuristic starts at zero trust.
2. **The app pattern looks suspicious to behavioural scanners.** Locally Uncensored is a Tauri app (small Rust binary + WebView), packaged with NSIS, that on first run downloads and executes other binaries (Ollama, ComfyUI, model files, Python). That combination overlaps with the behavioural fingerprint of certain droppers, even though every download path is open-source and visible in the code (`src-tauri/src/commands/install.rs`, `src-tauri/src/commands/ollama.rs`).
3. **NSIS itself is a frequently-flagged installer format**, since some malware families have used NSIS in the past.

### What you can do as a user

- **Verify the source.** Only download from the [official GitHub Releases page](https://github.com/PurpleDoubleD/locally-uncensored/releases). Every release is built by GitHub Actions from public source on the `master` branch, see `.github/workflows/release.yml`.
- **Verify the SHA-256.** From 3.0.8 on, every release has a `SHA256SUMS.txt`; download it next to the installer and run `sha256sum -c SHA256SUMS.txt --ignore-missing` (on Windows: `Get-FileHash` and compare). The same hash should appear on [VirusTotal](https://www.virustotal.com/) if you scan it yourself. Scan results for the installer are discussed in [Discussion #25](https://github.com/PurpleDoubleD/locally-uncensored/discussions/25).
- **Verify the auto-update.** Once installed, `Settings → Updates` checks `latest.json` from GitHub Releases and validates the bundle signature against this minisign public key:
  ```
  RWRHseb4LudtbIpBRaMDxMpSLMq+1TqeULJS/HY2/eviNqnAXVVyGsDc
  ```
  If a malicious update were ever served, the signature check would fail and the update would be rejected.
- **Submit the false positive.** Antivirus vendors fix false positives quickly when users submit the file. Direct links:
  - [ESET](https://support.eset.com/en/kb141-submit-a-virus-spyware-or-suspicious-file-to-eset-virus-lab)
  - [Microsoft Defender](https://www.microsoft.com/en-us/wdsi/filesubmission)
  - [Avast / AVG](https://www.avast.com/false-positive-file-form.php)
  - [Bitdefender](https://www.bitdefender.com/consumer/support/answer/29358/)
  - [Kaspersky](https://opentip.kaspersky.com/?tab=fileupload)
  - [Norton / Symantec](https://submit.norton.com/falsepositive)
  - [McAfee](https://www.mcafee.com/threat-intelligence/disputed-detection.aspx)
- **Build it yourself.** AGPL-3.0 means you can clone the repo, run `npm ci && npm run tauri build`, and end up with the same installer your antivirus is flagging, with your own signature surface. See `CONTRIBUTING.md` for the build steps.

### Code-signing roadmap

A signed installer is the long-term fix. Two paths exist:

- **SignPath Foundation**: free code signing for open source projects. The project has been accepted, and a test run from GitHub Actions has signed the installers with a test certificate. The production certificate follows after SignPath has reviewed the setup. Until then the installers ship unsigned.
- **Self-funded EV certificate**: about $300 to $600 a year. On the list once the project justifies the cost.

The auto-update channel is already signed (minisign), so the trust path after you have a working install is intact. The first install is the weak link, and it is the one we are working to close.

If you have experience with code signing for open source projects, get in touch on the Discord.
