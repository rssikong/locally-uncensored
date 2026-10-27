// One sentence per situation, in a desktop and a phone wording.
//
// The logic layer was written for a computer. Its messages name things a phone
// does not have: System Settings, a Settings tab with an install button, Piper,
// a Downloads folder, "this computer", a click. Where such a sentence can come
// up on a phone path, it gets a phone wording here: English, plain, and it
// names the next step.
//
// The desktop wording is the sentence that stood at the call site before, word
// for word. lib/__tests__/platform-text.test.ts pins every one of them, so a
// change to a desktop text is a decision and not an accident.
//
// Call sites ask platformText('key'). Sentences that only exist on a phone
// (nothing on the desktop says them) are in MOBILE_TEXT.

import { isMobile } from './device-kind'

interface Wording { desktop: string; mobile: string }

const TEXTS = {
  // ── Voice (hooks/useVoice.ts) ──────────────────────────────────────────
  micUnavailable: {
    desktop: 'Microphone unavailable, check mic permissions for LU in System Settings',
    mobile: 'Microphone unavailable. Allow the microphone for LU in the settings of this device, then try again.',
  },
  transcriptionFailed: {
    desktop: 'Transcription failed, check the microphone and try again',
    mobile: 'Transcription failed. Your recording is kept, check the connection and tap retry.',
  },
  sttSignedOut: {
    desktop: 'Signed out, sign in again to use cloud dictation',
    mobile: 'Signed out. Sign in to your LU Cloud account again, then tap retry. Your recording is kept.',
  },
  sttCloudDown: {
    desktop: 'Cloud transcription is unavailable right now, try again',
    mobile: 'LU Cloud transcription is unavailable right now. Your recording is kept, tap retry in a moment.',
  },
  micHintCloud: {
    desktop: 'Cloud dictation needs a signed-in account with credits. Sign in under Settings → Account.',
    mobile: 'Dictation runs on LU Cloud on this device and needs a signed-in account with credits. Sign in to your LU Cloud account.',
  },
  micHintLocal: {
    desktop: 'Speech-to-text is not installed. Install faster-whisper in Settings → Voice & Remote.',
    mobile: 'Dictation runs on LU Cloud on this device. Sign in to your LU Cloud account to use it.',
  },

  // ── Chat and Agent (hooks/useAgentChat.ts, hooks/useChat.ts) ───────────
  agentBackendLost: {
    desktop: 'Lost the connection to the local model backend mid-response, it may have crashed, been closed, or was busy swapping models. LU already retried automatically.\n\nCheck that Ollama / LM Studio is running (and the model still loads), then send the message again.\n\nDetails: {details}',
    mobile: 'Lost the connection to the model on this device mid-response. The system may have stopped it to free memory. LU already retried automatically.\n\nOpen Models and load the model again, then send the message again.\n\nDetails: {details}',
  },
  agentToolTransportSwitched: {
    desktop: 'This model refused native tool calling, so this run could not use tools. LU has switched it to the prompt-based tool transport, the same one the Coding surface uses. Send your message again and the agent will run with tools.',
    mobile: 'This model refused native tool calling, so this run could not use tools. LU has switched it to the prompt-based tool transport. Send your message again and the agent will run with tools.',
  },
  agentNoToolSupport: {
    desktop: "This model does not support tool calling, so it can't run in Agent mode. Pick a model shown with the tools badge, or turn tools off for plain chat.",
    mobile: 'This model does not support tool calling, so it cannot run in Agent mode. Pick a model that supports tools, or turn Agent off for plain chat.',
  },
  cloudSessionEndedMidRun: {
    desktop: 'Your LU Cloud session ended and could not be renewed, so the run stopped here. Sign in again in Settings, then carry on.',
    mobile: 'Your LU Cloud session ended and could not be renewed, so the run stopped here. Sign in to your LU Cloud account again, then carry on.',
  },
  localFilesNotice: {
    desktop: 'Plain chat cannot open files on this computer. Turn on Agent above the message box, choose "Pick a folder…" and select the folder that holds them, then ask again. Agent needs a model that can use tools.',
    mobile: 'Plain chat cannot open files on this device. Attach the file to your message, then ask again.',
  },
  outsideWorkspaceNotice: {
    desktop: 'The agent can only work with files in this chat\'s folder. To let it use another place, click the Sandbox or folder button next to Agent, choose "Pick a folder…" and select that folder, then ask again.',
    mobile: "The agent can only work with files in this chat's own folder on this device. Attach the file to your message, then ask again.",
  },
  outsideWorkspaceHint: {
    desktop: "Outside this chat's working folder. Ask the user to choose the folder that holds it as the working folder, then try again.",
    mobile: "Outside this chat's working folder, and no other folder can be chosen on this device. Ask the user to attach the file to a message instead.",
  },
  attachedFileInWorkspace: {
    desktop: 'Path in your working folder: {path}\nUse your file and shell tools on that path for anything this summary does not answer.',
    mobile: 'Path in your working folder: {path}\nUse your file tools on that path for anything this summary does not answer.',
  },

  // ── The engine on this device (api/builtin-ensure.ts and friends) ──────
  repeatedQuestionMarks: {
    desktop: 'Generation stopped because the local model repeated question marks continuously. Try setting GPU Layers to 0 in LU Engine settings, or verify and download the model again.',
    mobile: 'Generation stopped because the model on this device repeated question marks continuously. Open Models and download the model again, or pick a smaller one.',
  },
  engineNotAnswering: {
    desktop: 'The LU Engine is not answering on {host}. It is either still loading a model, failed to start, or was shut down. Wait for the model to finish loading and send again, or open Settings, AI Backends, LU Engine and start it there.',
    mobile: 'The model on this device is not answering. It is either still loading or the system stopped it to free memory. Wait a moment and send again, or open Models and load it again.',
  },
  engineSwitchedOff: {
    desktop: 'The LU Engine is switched off in Settings, AI Backends. Turn it back on there, or pick a model from another provider.',
    mobile: 'The engine on this device is switched off. Turn it back on in Settings, or pick an LU Cloud model.',
  },
  engineModelFileMissing: {
    desktop: 'The LU Engine has no model file named "{name}". It may have been deleted, moved, or the download did not finish. Open Models, Get new and download it again, then pick it in the chat.',
    mobile: 'The model file "{name}" is not on this device. It may have been deleted, or the download did not finish. Open Models and download it again, then pick it in the chat.',
  },
  engineModelFileMissingShort: {
    desktop: 'The LU Engine has no model file named "{name}". It may have been deleted, moved, or the download did not finish. Open Models, Get new and download it again.',
    mobile: 'The model file "{name}" is not on this device. It may have been deleted, or the download did not finish. Open Models and download it again.',
  },
  engineNoChatModel: {
    desktop: 'The LU Engine is installed but has no chat model to load yet. Open Models, Get new and install one, then test again.',
    mobile: 'No chat model is on this device yet. Open Models and download one, then test again.',
  },
  engineFileGone: {
    desktop: 'the file behind that row is not in the LU Engine folder any more. Check Settings, AI Backends, Storage.',
    mobile: 'the file behind that row is not on this device any more. Open Models and download it again.',
  },
  engineCpuOnly: {
    desktop: 'Running on the CPU. The GPU start failed; see the log file in Settings > Troubleshoot.',
    mobile: 'Running on the CPU because the GPU start failed, so answers are slower. Pick a smaller model if this is too slow.',
  },
  localBackendUnreachable: {
    desktop: '{name} is not answering on {host}. It is either not running, still starting up, or listening on a different address. Start it and send again, or pick a different backend in Settings, AI Backends.',
    mobile: '{name} is not answering on {host}. It is either not running, still starting up, or listening on a different address. Start it and send again, or pick a different model.',
  },
  remoteBackendUnreachable: {
    desktop: '{name} is not answering on {host}. The request never reached it, so the address may be wrong or the connection may be down. Check the base URL in Settings, AI Backends, and check your network, then send again.',
    mobile: '{name} is not answering on {host}. The request never reached it, so the address may be wrong or the connection may be down. Check the base URL of this provider in Settings and your connection, then send again.',
  },
  ollamaOnlyModel: {
    desktop: '{model} only runs on Ollama. Enable the Ollama provider (Settings → Providers) before downloading.',
    mobile: '{model} only runs on Ollama, which this device does not have. Pick a model in GGUF format instead.',
  },

  // ── Document Chat (lib/docs-availability.ts, hooks/useRAG.ts) ──────────
  docsTitleCloudLocal: {
    desktop: 'Document Chat (RAG). Files stay on this computer, only matching passages go to the cloud model.',
    mobile: 'Document Chat (RAG). Files stay on this device, only matching passages go to the cloud model.',
  },
  docsTitleNoEmbeddings: {
    desktop: 'Documents need the local embeddings engine. Click to install it.',
    mobile: 'Documents need the embedding model on this device. Tap to install it.',
  },
  ragContextSmall: {
    desktop: "Your model's context window is only {ctx} tokens. RAG works best with 4096+ tokens \u2014 pick a model with a larger context window (or raise it in your backend's settings).",
    mobile: "Your model's context window is only {ctx} tokens. Document Chat works best with 4096 or more. Pick a model with a larger context window.",
  },
  ragNoEmbedBackend: {
    desktop: 'No embedding backend is running. Start the LU Engine (or Ollama) and try again.',
    mobile: 'The embedding model on this device is not running. Open Document Chat, install or load it, then try again.',
  },

  // ── Account and LU Cloud ──────────────────────────────────────────────
  signOutFailed: {
    desktop: 'Sign-out failed \u2014 the saved session is still on this computer, so the account stays signed in here. {failure}',
    mobile: 'Sign-out failed. The saved session is still on this device, so the account stays signed in here. {failure}',
  },
  renderStillRunning: {
    desktop: 'Still rendering, this is taking longer than expected. When it completes you can view it in your account at lu-labs.ai.',
    mobile: 'Still rendering, this is taking longer than expected. It lands in your gallery when it is done, you can keep using the app.',
  },
  renderStillRunningSome: {
    desktop: 'Still rendering, some images are taking longer than expected. When they complete you can view them in your account at lu-labs.ai.',
    mobile: 'Still rendering, some images are taking longer than expected. They land in your gallery when they are done.',
  },
  cloudCopyGone: {
    desktop: 'The cloud copy of this render is no longer available. Pick another image, or upload one from disk.',
    mobile: 'The cloud copy of this render is no longer available. Pick another image, or add one from your photos.',
  },
  improveHintLocal: {
    desktop: 'Your chat model rewrites your prompt for the model you picked. It runs on your machine.',
    mobile: 'Your chat model rewrites your prompt for the model you picked. It runs on this device.',
  },

  // ── Small words ───────────────────────────────────────────────────────
  thisComputer: {
    desktop: 'this computer',
    mobile: 'this device',
  },
} satisfies Record<string, Wording>

export type PlatformTextKey = keyof typeof TEXTS

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  // One pass over the wording: a value that itself contains "{host}" (a
  // server's error line can contain anything) is never filled a second time.
  return text.replace(/\{([a-z]+)\}/g, (place, name: string) => (name in vars ? String(vars[name]) : place))
}

/**
 * The sentence for this device. `vars` fills the `{name}` places a wording
 * carries (a host, a file name, the server's own detail line).
 */
export function platformText(key: PlatformTextKey, vars?: Record<string, string | number>): string {
  return fill(isMobile() ? TEXTS[key].mobile : TEXTS[key].desktop, vars)
}

/** Both wordings of every key. For the guard test and for nothing else. */
export const PLATFORM_TEXTS: Readonly<Record<PlatformTextKey, Wording>> = TEXTS

/** Sentences only a phone says. */
export const MOBILE_TEXT = {
  /** The loop stop of the engine on a phone (lib/repetition-stop.ts, LoopStop). The desktop engine has no such stop. */
  repeatedOutput: 'Generation stopped because the model on this device kept repeating the same text. Ask again, or pick a larger model. Very small models get stuck this way.',
  dictationNeedsCloud: 'Dictation runs on LU Cloud on this device. Sign in to your LU Cloud account to use it.',
  dictationStoppedInBackground: 'Recording stopped because LU left the screen. Your recording is kept, tap retry to transcribe it.',
  readAloudNeedsCloud: 'Read aloud runs on LU Cloud on this device. Sign in to your LU Cloud account to use it.',
  dictationNeedsConsent: 'Dictation sends your recording to LU Cloud. Nothing was recorded, because you have not agreed to that.',
  readAloudNeedsConsent: 'Read aloud sends the text to LU Cloud. Nothing was sent, because you have not agreed to that.',
  readAloudCloudFailed: 'LU Cloud could not read this aloud. Check the connection and try again.',
  readAloudCloudFailedSystemVoice: 'LU Cloud could not read this aloud, so the system voice was used. Try again in a moment.',
  readAloudOutOfCredits: 'You are out of credits, so LU Cloud could not read this aloud. Add credits to your LU Cloud account, then try again.',
  /** A document whose passages neither IndexedDB nor the native backup took (D-VW, check of package 17). `{name}`: the file. */
  documentNotKept: 'LU could not save "{name}" on this phone, so it cannot be searched. LU needs a restart before it can save documents again.',
} as const
