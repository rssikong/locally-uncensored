/**
 * Point 10 of the mobile groundwork: the text seam.
 *
 * The logic layer was written for a computer, and its sentences name things a
 * phone does not have. lib/platform-text.ts holds a desktop and a phone
 * wording for every such sentence that can come up on a phone path.
 *
 * What this file guards:
 *   1. every DESKTOP wording, pinned word for word (the table below was taken
 *      from the call sites as they stood before the seam existed)
 *   2. every PHONE wording: English, no dash, no desktop-only noun, and it
 *      ends as a sentence
 *   3. the call sites really ask the seam, on both kinds of device
 *
 * Run: npx vitest run src/lib/__tests__/platform-text.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DESKTOPS, HANDHELDS, standOn } from '../../test-support/devices'
import { MOBILE_TEXT, PLATFORM_TEXTS, platformText } from '../platform-text'
import type { PlatformTextKey } from '../platform-text'

const src = (rel: string) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..', rel), 'utf8')

/** The desktop sentences, as they stood at their call sites. Do not edit to
 *  make a test pass: a change here is a change to what desktop users read. */
const DESKTOP_PINNED: Record<PlatformTextKey, string> = {
  micUnavailable: "Microphone unavailable, check mic permissions for LU in System Settings",
  transcriptionFailed: "Transcription failed, check the microphone and try again",
  sttSignedOut: "Signed out, sign in again to use cloud dictation",
  sttCloudDown: "Cloud transcription is unavailable right now, try again",
  micHintCloud: "Cloud dictation needs a signed-in account with credits. Sign in under Settings \u2192 Account.",
  micHintLocal: "Speech-to-text is not installed. Install faster-whisper in Settings \u2192 Voice & Remote.",
  agentBackendLost: "Lost the connection to the local model backend mid-response, it may have crashed, been closed, or was busy swapping models. LU already retried automatically.\n\nCheck that Ollama / LM Studio is running (and the model still loads), then send the message again.\n\nDetails: {details}",
  agentToolTransportSwitched: "This model refused native tool calling, so this run could not use tools. LU has switched it to the prompt-based tool transport, the same one the Coding surface uses. Send your message again and the agent will run with tools.",
  agentNoToolSupport: "This model does not support tool calling, so it can't run in Agent mode. Pick a model shown with the tools badge, or turn tools off for plain chat.",
  cloudSessionEndedMidRun: "Your LU Cloud session ended and could not be renewed, so the run stopped here. Sign in again in Settings, then carry on.",
  localFilesNotice: "Plain chat cannot open files on this computer. Turn on Agent above the message box, choose \"Pick a folder\u2026\" and select the folder that holds them, then ask again. Agent needs a model that can use tools.",
  outsideWorkspaceNotice: "The agent can only work with files in this chat's folder. To let it use another place, click the Sandbox or folder button next to Agent, choose \"Pick a folder\u2026\" and select that folder, then ask again.",
  outsideWorkspaceHint: "Outside this chat's working folder. Ask the user to choose the folder that holds it as the working folder, then try again.",
  attachedFileInWorkspace: "Path in your working folder: {path}\nUse your file and shell tools on that path for anything this summary does not answer.",
  repeatedQuestionMarks: "Generation stopped because the local model repeated question marks continuously. Try setting GPU Layers to 0 in LU Engine settings, or verify and download the model again.",
  engineNotAnswering: "The LU Engine is not answering on {host}. It is either still loading a model, failed to start, or was shut down. Wait for the model to finish loading and send again, or open Settings, AI Backends, LU Engine and start it there.",
  engineSwitchedOff: "The LU Engine is switched off in Settings, AI Backends. Turn it back on there, or pick a model from another provider.",
  engineModelFileMissing: "The LU Engine has no model file named \"{name}\". It may have been deleted, moved, or the download did not finish. Open Models, Get new and download it again, then pick it in the chat.",
  engineModelFileMissingShort: "The LU Engine has no model file named \"{name}\". It may have been deleted, moved, or the download did not finish. Open Models, Get new and download it again.",
  engineNoChatModel: "The LU Engine is installed but has no chat model to load yet. Open Models, Get new and install one, then test again.",
  engineFileGone: "the file behind that row is not in the LU Engine folder any more. Check Settings, AI Backends, Storage.",
  engineCpuOnly: "Running on the CPU. The GPU start failed; see the log file in Settings > Troubleshoot.",
  localBackendUnreachable: "{name} is not answering on {host}. It is either not running, still starting up, or listening on a different address. Start it and send again, or pick a different backend in Settings, AI Backends.",
  remoteBackendUnreachable: "{name} is not answering on {host}. The request never reached it, so the address may be wrong or the connection may be down. Check the base URL in Settings, AI Backends, and check your network, then send again.",
  ollamaOnlyModel: "{model} only runs on Ollama. Enable the Ollama provider (Settings \u2192 Providers) before downloading.",
  docsTitleCloudLocal: "Document Chat (RAG). Files stay on this computer, only matching passages go to the cloud model.",
  docsTitleNoEmbeddings: "Documents need the local embeddings engine. Click to install it.",
  ragContextSmall: "Your model's context window is only {ctx} tokens. RAG works best with 4096+ tokens \u2014 pick a model with a larger context window (or raise it in your backend's settings).",
  ragNoEmbedBackend: "No embedding backend is running. Start the LU Engine (or Ollama) and try again.",
  signOutFailed: "Sign-out failed \u2014 the saved session is still on this computer, so the account stays signed in here. {failure}",
  renderStillRunning: "Still rendering, this is taking longer than expected. When it completes you can view it in your account at lu-labs.ai.",
  renderStillRunningSome: "Still rendering, some images are taking longer than expected. When they complete you can view them in your account at lu-labs.ai.",
  cloudCopyGone: "The cloud copy of this render is no longer available. Pick another image, or upload one from disk.",
  improveHintLocal: "Your chat model rewrites your prompt for the model you picked. It runs on your machine.",
  thisComputer: "this computer",
}

/** What a phone does not have, or does not call by that name. */
const DESKTOP_ONLY = /LM Studio|this computer|AI Backends|Piper|faster-whisper|\bclick|Downloads folder|System Settings|your machine|Get new|shell tools|from disk|Coding surface|tools badge|GPU Layers|Troubleshoot|Model Storage|Voice & Remote|[\u2013\u2014\u2192]/i

afterEach(() => { vi.unstubAllGlobals() })

describe('the desktop wordings', () => {
  it('are word for word what they were', () => {
    expect(Object.keys(PLATFORM_TEXTS).sort()).toEqual(Object.keys(DESKTOP_PINNED).sort())
    for (const key of Object.keys(DESKTOP_PINNED) as PlatformTextKey[]) {
      expect(PLATFORM_TEXTS[key].desktop, key).toBe(DESKTOP_PINNED[key])
    }
  })

  for (const device of DESKTOPS) {
    it(`${device}: every key answers with its desktop wording`, () => {
      standOn(device)
      for (const key of Object.keys(DESKTOP_PINNED) as PlatformTextKey[]) {
        expect(platformText(key), key).toBe(DESKTOP_PINNED[key])
      }
    })
  }
})

describe('the phone wordings', () => {
  for (const device of HANDHELDS) {
    it(`${device}: every key answers with its phone wording`, () => {
      standOn(device)
      for (const key of Object.keys(PLATFORM_TEXTS) as PlatformTextKey[]) {
        expect(platformText(key), key).toBe(PLATFORM_TEXTS[key].mobile)
        expect(platformText(key), key).not.toBe(PLATFORM_TEXTS[key].desktop)
      }
    })
  }

  it('name nothing a phone lacks and carry no dash', () => {
    const all: [string, string][] = [
      ...Object.entries(PLATFORM_TEXTS).map(([k, v]): [string, string] => [k, v.mobile]),
      ...Object.entries(MOBILE_TEXT),
    ]
    for (const [key, text] of all) {
      expect(text, key).not.toMatch(DESKTOP_ONLY)
      // Ollama is named in exactly one phone sentence: the one that says this
      // device does not have it.
      if (key !== 'ollamaOnlyModel') expect(text, key).not.toMatch(/Ollama/)
      // A menu path (Settings > X, or Settings, X) is a desktop habit.
      expect(text, key).not.toMatch(/Settings\s*(>|, [A-Z])/)
    }
  })

  it('are sentences: a capital or a quote in front, a period at the end', () => {
    for (const [key, v] of Object.entries(PLATFORM_TEXTS)) {
      // Two keys are fragments their call site completes.
      if (key === 'thisComputer' || key === 'engineFileGone') continue
      const text = v.mobile.replace(/\{[a-z]+\}/g, 'X')
      expect(text, key).toMatch(/^[A-Z"]/)
      expect(text.endsWith('.') || text.endsWith('X'), key).toBe(true)
    }
    for (const [key, text] of Object.entries(MOBILE_TEXT)) {
      expect(text, key).toMatch(/^[A-Z]/)
      expect(text.endsWith('.'), key).toBe(true)
    }
  })

  it('fill no place the desktop wording does not have', () => {
    const places = (s: string) => new Set(s.match(/\{[a-z]+\}/g) ?? [])
    for (const [key, v] of Object.entries(PLATFORM_TEXTS)) {
      const d = places(v.desktop)
      for (const p of places(v.mobile)) expect(d.has(p), `${key} ${p}`).toBe(true)
    }
  })

  it('say the next step where the desktop wording said one', () => {
    standOn('iphone')
    expect(platformText('engineNotAnswering', { host: '127.0.0.1:8127' })).toBe(
      'The model on this device is not answering. It is either still loading or the system stopped it to free memory. Wait a moment and send again, or open Models and load it again.',
    )
    expect(platformText('agentBackendLost', { details: 'ECONNRESET' })).toBe(
      'Lost the connection to the model on this device mid-response. The system may have stopped it to free memory. LU already retried automatically.\n\nOpen Models and load the model again, then send the message again.\n\nDetails: ECONNRESET',
    )
    expect(platformText('renderStillRunning')).toBe(
      'Still rendering, this is taking longer than expected. It lands in your gallery when it is done, you can keep using the app.',
    )
    expect(platformText('localFilesNotice')).toBe('Plain chat cannot open files on this device. Attach the file to your message, then ask again.')
  })
})

describe('places are filled', () => {
  it('desktop: the filled sentence is the old template', () => {
    standOn('windows')
    expect(platformText('engineNotAnswering', { host: '127.0.0.1:8127' })).toBe(
      'The LU Engine is not answering on 127.0.0.1:8127. It is either still loading a model, failed to start, or was shut down. Wait for the model to finish loading and send again, or open Settings, AI Backends, LU Engine and start it there.',
    )
    expect(platformText('ragContextSmall', { ctx: 2048 })).toBe(
      "Your model's context window is only 2048 tokens. RAG works best with 4096+ tokens \u2014 pick a model with a larger context window (or raise it in your backend's settings).",
    )
    expect(platformText('attachedFileInWorkspace', { path: 'notes/a.txt' })).toBe(
      'Path in your working folder: notes/a.txt\nUse your file and shell tools on that path for anything this summary does not answer.',
    )
  })

  it('a value that looks like a place is not filled twice', () => {
    standOn('windows')
    expect(platformText('localBackendUnreachable', { name: '{host}', host: '10.0.0.2:1234' })).toContain('{host} is not answering on 10.0.0.2:1234.')
    expect(platformText('signOutFailed', { failure: '{failure} {host}' })).toBe(
      'Sign-out failed \u2014 the saved session is still on this computer, so the account stays signed in here. {failure} {host}',
    )
  })
})

/** Load the modules that hold a wording in a constant, on a given device. */
async function callSitesOn(device: Parameters<typeof standOn>[0]) {
  vi.resetModules()
  standOn(device)
  const [files, refusal, ensure, sw, offload, docs, transport, target, exp, chatFiles, hints, voiceButton] = await Promise.all([
    import('../local-file-intent'), import('../workspace-refusal'), import('../../api/builtin-ensure'),
    import('../../api/lu-engine-switch'), import('../engine-offload'), import('../docs-availability'),
    import('../local-backend-transport'), import('../text-download-target'), import('../chat-export'),
    import('../chat-files'), import('../../api/agents/error-hints'), import('../../components/chat/VoiceButton'),
  ])
  return {
    localFilesNotice: files.LOCAL_FILES_NOTICE,
    outsideWorkspaceNotice: refusal.OUTSIDE_WORKSPACE_NOTICE,
    engineSwitchedOff: ensure.BUILTIN_SLOT_OFF_MESSAGE,
    engineFileGone: sw.LU_ENGINE_FILE_GONE,
    engineCpuOnly: offload.ENGINE_CPU_ONLY_NOTE,
    docsTitleCloudLocal: docs.DOCS_TITLE_CLOUD_LOCAL,
    docsTitleNoEmbeddings: docs.DOCS_TITLE_NO_EMBEDDINGS,
    localBackendUnreachable: transport.localBackendUnreachableMessage('vLLM', 'http://192.168.1.20:8000/v1'),
    remoteBackendUnreachable: transport.remoteBackendUnreachableMessage('My API', 'https://api.example.com/v1'),
    ollamaOnlyModel: target.ollamaOnlyDownloadBlock('qwen3:8b', false),
    missingImages: exp.missingImagesNote(2),
    fileBlock: chatFiles.fileBlock({ name: 'a.txt', workspacePath: 'notes/a.txt', summary: 'Text.', binary: false } as never, 'workspace'),
    outsideWorkspaceHint: hints.explainError('file_read', 'Path escapes the allowed workspace: Not an allowed workspace folder'),
    micHintCloud: voiceButton.micUnavailableHint(true),
    micHintLocal: voiceButton.micUnavailableHint(false),
  }
}

describe('the call sites ask the seam', () => {
  for (const device of DESKTOPS) {
    it(`DESKTOP UNCHANGED ${device}: every constant and function says what it always said`, async () => {
      const site = await callSitesOn(device)
      expect(site.localFilesNotice).toBe(DESKTOP_PINNED.localFilesNotice)
      expect(site.outsideWorkspaceNotice).toBe(DESKTOP_PINNED.outsideWorkspaceNotice)
      expect(site.engineSwitchedOff).toBe(DESKTOP_PINNED.engineSwitchedOff)
      expect(site.engineFileGone).toBe(DESKTOP_PINNED.engineFileGone)
      expect(site.engineCpuOnly).toBe(DESKTOP_PINNED.engineCpuOnly)
      expect(site.docsTitleCloudLocal).toBe(DESKTOP_PINNED.docsTitleCloudLocal)
      expect(site.docsTitleNoEmbeddings).toBe(DESKTOP_PINNED.docsTitleNoEmbeddings)
      expect(site.localBackendUnreachable).toBe('vLLM is not answering on 192.168.1.20:8000. It is either not running, still starting up, or listening on a different address. Start it and send again, or pick a different backend in Settings, AI Backends.')
      expect(site.remoteBackendUnreachable).toBe('My API is not answering on api.example.com. The request never reached it, so the address may be wrong or the connection may be down. Check the base URL in Settings, AI Backends, and check your network, then send again.')
      expect(site.ollamaOnlyModel).toBe('qwen3:8b only runs on Ollama. Enable the Ollama provider (Settings \u2192 Providers) before downloading.')
      expect(site.missingImages).toBe(' 2 images were no longer on this computer and could not be included.')
      expect(site.fileBlock).toContain('Path in your working folder: notes/a.txt\nUse your file and shell tools on that path for anything this summary does not answer.')
      expect(site.outsideWorkspaceHint).toBe(DESKTOP_PINNED.outsideWorkspaceHint)
      expect(site.micHintCloud).toBe(DESKTOP_PINNED.micHintCloud)
      expect(site.micHintLocal).toBe(DESKTOP_PINNED.micHintLocal)
    })
  }

  for (const device of HANDHELDS) {
    it(`${device}: every one of them says the phone wording`, async () => {
      const site = await callSitesOn(device)
      expect(site.localFilesNotice).toBe(PLATFORM_TEXTS.localFilesNotice.mobile)
      expect(site.outsideWorkspaceNotice).toBe(PLATFORM_TEXTS.outsideWorkspaceNotice.mobile)
      expect(site.engineSwitchedOff).toBe(PLATFORM_TEXTS.engineSwitchedOff.mobile)
      expect(site.engineFileGone).toBe(PLATFORM_TEXTS.engineFileGone.mobile)
      expect(site.engineCpuOnly).toBe(PLATFORM_TEXTS.engineCpuOnly.mobile)
      expect(site.docsTitleCloudLocal).toBe(PLATFORM_TEXTS.docsTitleCloudLocal.mobile)
      expect(site.docsTitleNoEmbeddings).toBe(PLATFORM_TEXTS.docsTitleNoEmbeddings.mobile)
      expect(site.localBackendUnreachable).toBe('vLLM is not answering on 192.168.1.20:8000. It is either not running, still starting up, or listening on a different address. Start it and send again, or pick a different model.')
      expect(site.remoteBackendUnreachable).toContain('Check the base URL of this provider in Settings and your connection, then send again.')
      expect(site.ollamaOnlyModel).toBe('qwen3:8b only runs on Ollama, which this device does not have. Pick a model in GGUF format instead.')
      expect(site.missingImages).toBe(' 2 images were no longer on this device and could not be included.')
      expect(site.fileBlock).toContain('Use your file tools on that path')
      expect(site.fileBlock).not.toContain('shell tools')
      expect(site.outsideWorkspaceHint).toBe(PLATFORM_TEXTS.outsideWorkspaceHint.mobile)
      expect(site.micHintCloud).toBe(PLATFORM_TEXTS.micHintCloud.mobile)
      expect(site.micHintLocal).toBe(PLATFORM_TEXTS.micHintLocal.mobile)
      for (const [key, text] of Object.entries(site)) {
        if (key !== 'ollamaOnlyModel') expect(String(text), key).not.toMatch(/Ollama|LM Studio|this computer|AI Backends|\bclick|shell tools/i)
      }
    })
  }

  it('the sentences built inside hooks and providers come from the seam too', () => {
    const agent = src('hooks/useAgentChat.ts')
    expect(agent).toContain("platformText('agentBackendLost', { details: errorMsg })")
    expect(agent).toContain("? platformText('agentToolTransportSwitched')")
    expect(agent).toContain(": platformText('agentNoToolSupport')")
    expect(agent).toContain("platformText('cloudSessionEndedMidRun') + planLine")
    expect(agent).not.toContain('Check that Ollama / LM Studio is running')
    expect(src('api/providers/openai-provider.ts')).toContain("throw new Error(platformText('repeatedQuestionMarks'))")
    const ensure = src('api/builtin-ensure.ts')
    expect(ensure).toContain("return platformText('engineNotAnswering', { host })")
    expect(ensure).toContain("platformText('engineModelFileMissing', { name: bare })")
    expect(ensure).toContain("reason: platformText('engineModelFileMissingShort', { name: bare })")
    expect(ensure).toContain("platformText('engineNoChatModel')")
    const rag = src('hooks/useRAG.ts')
    expect(rag).toContain("platformText('ragContextSmall', { ctx: ctxLen })")
    expect(rag).toContain("platformText('ragNoEmbedBackend')")
    expect(src('hooks/useCloudAuth.ts')).toContain("platformText('signOutFailed', { failure })")
    const create = src('hooks/useCloudCreate.ts')
    expect(create).toContain("st.setError(platformText('renderStillRunning'))")
    expect(create).toContain("notes.push(platformText('renderStillRunningSome'))")
    expect(src('components/create/experimental/galleryUrl.ts')).toContain("throw new Error(platformText('cloudCopyGone'))")
    expect(src('lib/render/improve-prompt-run.ts')).toContain("const HINT_LOCAL = platformText('improveHintLocal')")
    expect(src('hooks/useVoice.ts')).toContain('store.setSttError(platformText("micUnavailable"));')
  })
})
