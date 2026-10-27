/**
 * Curated chat models for LU Mobile.
 *
 * Small GGUF models (about 0.4B to 4B parameters, Q4_K_M) that can run on a
 * phone or tablet, plus the embedding model for Document Chat.
 *
 * Format: every entry IS a `DiscoverModel` (api/model-bundles.ts), the type the
 * desktop Model Hub and `planModelDownload` already take, with the fields the
 * desktop catalog leaves optional made mandatory (downloadUrl, filename,
 * sizeGB, sizeBytes, sha256) and `expectedBytes` added under the name the
 * onboarding catalog (`OnboardingModel` in lib/constants.ts) and
 * `startModelDownload` use. `toOnboardingModel` gives the onboarding shape.
 *
 * Every file was checked on 2026-10-08:
 *   - HEAD on the resolve URL, following redirects, answered 200 and the
 *     Content-Length equals `sizeBytes`.
 *   - `sizeBytes` and `sha256` are Hugging Face's own LFS metadata
 *     (api/models/<repo>/tree/main, lfs.size and lfs.oid).
 *   - `arch` and `trainedContext` were read from the GGUF header of the file
 *     itself (first megabyte, range request): block_count, head_count_kv,
 *     key_length, value_length, context_length.
 *   - `license` is the license on the model card of the GGUF repo (for the
 *     Phi 4 Mini repo, which has none on the card, the `general.license` key
 *     inside the GGUF).
 * None of the repos is gated.
 *
 * Every file was then loaded and asked two questions with the mobile engine's
 * llama.cpp (llama-cpp-2 0.1.154) on a Mac, on Metal and on the processor
 * (mobile-docs/KATALOG-PROBE.md, 2026-10-08). All nine architectures load,
 * `qwen35` and `gemma4` included. Three things in this file come from that
 * run and not from the GGUF header:
 *   - `kvBytesPerToken` of the six Qwen 3.5 entries and of Gemma 4 E2B.
 *     llama.cpp allocates about a quarter of what the attention shape says,
 *     so those entries carry the measured figure (`kvMeasured`).
 *   - `thinking`: the model writes a `<think>` block before its answer.
 *   - `NOT_RECOMMENDED`: models that did not answer a plain question.
 *
 * Vision: Qwen 3.5, Gemma 3 4B and Gemma 4 can read images with a separate
 * projector file. The catalog leaves `mmprojUrl` out on purpose: the projector
 * costs 0.2 to 1 GB of extra memory that the fit calculation does not cover yet.
 */
import type { DiscoverModel } from '../../api/model-bundles'
import type { OnboardingModel } from '../../lib/constants'
import { ramClassFor, type MobilePlatform } from './device-memory'

const GIB = 1_073_741_824

export type MobileModelFamily = 'qwen' | 'gemma' | 'llama' | 'phi' | 'smollm'

/** Attention shape, read from the GGUF header. Drives the KV cache estimate. */
export interface MobileModelArch {
  /** Transformer blocks (`<arch>.block_count`). */
  blocks: number
  /** Key/value heads (`<arch>.attention.head_count_kv`). */
  kvHeads: number
  /** `<arch>.attention.key_length`, or embedding_length / head_count when absent. */
  keyLength: number
  /** `<arch>.attention.value_length`, same fallback. */
  valueLength: number
}

export interface MobileModel extends DiscoverModel {
  /** Stable key for selection, recommendations and tests. */
  id: string
  family: MobileModelFamily
  /** Parameters in billions. */
  paramsB: number
  quant: 'Q4_K_M'
  /** True for abliterated and other models tuned to answer without refusals. */
  uncensored: boolean
  /**
   * The same fact under the name the store policy uses
   * (`unfilteredCatalog === false` hides every entry with `unfiltered: true`).
   * Always equal to `uncensored`, which the desktop types carry.
   */
  unfiltered: boolean
  /**
   * The model writes a `<think>` block before it answers (measured,
   * KATALOG-PROBE.md section 3). The engine hands that text over as
   * `reasoning_content`, and the Thinking switch can turn it off.
   */
  thinking: boolean
  /** Hugging Face repo the file lives in. */
  repo: string
  downloadUrl: string
  filename: string
  sizeGB: number
  /** Exact size of the file in bytes (HF LFS metadata, equal to the HEAD Content-Length). */
  sizeBytes: number
  /** Same number under the name the download commands use. */
  expectedBytes: number
  sha256: string
  /** SPDX style id or the license key of the model card. */
  license: string
  /** Set when the license is not a plain open source license. */
  licenseNote?: string
  arch: MobileModelArch
  /**
   * Bytes of KV cache per context token with 16 bit keys and values. From the
   * attention shape, blocks * kvHeads * (keyLength + valueLength) * 2, unless
   * the entry carries a measured figure (`kvSource`).
   */
  kvBytesPerToken: number
  /**
   * `measured`: what llama.cpp really allocated per token (KATALOG-PROBE.md
   * section 6), because the formula does not hold for this architecture.
   * `formula`: the attention shape, which the same run confirmed to the byte.
   */
  kvSource: 'formula' | 'measured'
  /** Context the model was trained for (`<arch>.context_length`). */
  trainedContext: number
}

type Seed = Pick<MobileModel, 'id' | 'name' | 'family' | 'paramsB' | 'uncensored' | 'repo' | 'filename' | 'sizeBytes' | 'sha256' | 'license' | 'tags' | 'arch' | 'trainedContext'>
  & {
    agent: boolean; released: string; blurb: string
    /** Measured KV cache bytes per token, where the formula is wrong (Qwen 3.5, Gemma 4). */
    kvMeasured?: number
    /** Writes a `<think>` block. Left out means no. */
    thinking?: boolean
  }

const HF = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`

const LICENSE_NOTES: Record<string, string> = {
  gemma: 'Gemma Terms of Use (Google). Use is allowed, including commercially, under Google\'s prohibited use policy.',
  'llama3.2': 'Llama 3.2 Community License (Meta). Use is allowed under Meta\'s acceptable use policy.',
  llama3: 'Llama 3 Community License (Meta). Use is allowed under Meta\'s acceptable use policy.',
}

export function kvBytesPerToken(arch: MobileModelArch): number {
  return arch.blocks * arch.kvHeads * (arch.keyLength + arch.valueLength) * 2
}

function m({ kvMeasured, thinking, ...seed }: Seed): MobileModel {
  const note = LICENSE_NOTES[seed.license]
  return {
    ...seed,
    unfiltered: seed.uncensored,
    thinking: thinking === true,
    quant: 'Q4_K_M',
    description: seed.blurb,
    pulls: '',
    updated: '',
    lightweight: true,
    url: `https://huggingface.co/${seed.repo}`,
    downloadUrl: HF(seed.repo, seed.filename),
    sizeGB: seed.sizeBytes / GIB,
    expectedBytes: seed.sizeBytes,
    kvBytesPerToken: kvMeasured ?? kvBytesPerToken(seed.arch),
    kvSource: kvMeasured ? 'measured' : 'formula',
    ...(note ? { licenseNote: note } : {}),
  }
}

/** Ordered by file size within each group: mainstream first, then uncensored. */
export const MOBILE_CHAT_MODELS: MobileModel[] = [
  // Mainstream
  m({
    id: 'smollm2-360m', name: 'SmolLM2 360M', family: 'smollm', paramsB: 0.36, uncensored: false, agent: false,
    repo: 'bartowski/SmolLM2-360M-Instruct-GGUF',
    filename: 'SmolLM2-360M-Instruct-Q4_K_M.gguf',
    sizeBytes: 270590880, sha256: '2fa3f013dcdd7b99f9b237717fa0b12d75bbb89984cc1274be1471a465bac9c2',
    license: 'apache-2.0', released: '2024-11', tags: ['360M', 'Q4_K_M', '271 MB'],
    arch: { blocks: 32, kvHeads: 5, keyLength: 64, valueLength: 64 }, trainedContext: 8192,
    blurb: 'Tiny helper for very small phones. Short answers, simple tasks.',
  }),
  m({
    id: 'qwen3-0.6b', name: 'Qwen3 0.6B', family: 'qwen', paramsB: 0.6, uncensored: false, agent: false,
    repo: 'unsloth/Qwen3-0.6B-GGUF',
    filename: 'Qwen3-0.6B-Q4_K_M.gguf',
    sizeBytes: 396705472, sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
    license: 'apache-2.0', released: '2025-04', tags: ['0.6B', 'Q4_K_M', '397 MB'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 40960, thinking: true,
    blurb: 'Small and quick. Good for short questions on older phones.',
  }),
  m({
    id: 'qwen3.5-0.8b', name: 'Qwen 3.5 0.8B', family: 'qwen', paramsB: 0.8, uncensored: false, agent: false,
    repo: 'unsloth/Qwen3.5-0.8B-GGUF',
    filename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeBytes: 532517120, sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
    license: 'apache-2.0', released: '2026-03', tags: ['0.8B', 'Q4_K_M', '533 MB'],
    arch: { blocks: 24, kvHeads: 2, keyLength: 256, valueLength: 256 }, trainedContext: 262144, kvMeasured: 12288, thinking: true,
    blurb: 'Newest small Qwen. Light on memory, good for everyday chat on older phones.',
  }),
  m({
    id: 'gemma-3-1b', name: 'Gemma 3 1B', family: 'gemma', paramsB: 1.0, uncensored: false, agent: false,
    repo: 'unsloth/gemma-3-1b-it-GGUF',
    filename: 'gemma-3-1b-it-Q4_K_M.gguf',
    sizeBytes: 806058272, sha256: '8270790f3ab69fdfe860b7b64008d9a19986d8df7e407bb018184caa08798ebd',
    license: 'gemma', released: '2025-03', tags: ['1B', 'Q4_K_M', '806 MB'],
    arch: { blocks: 26, kvHeads: 1, keyLength: 256, valueLength: 256 }, trainedContext: 32768,
    blurb: 'Google Gemma 3 in its smallest chat size. Clean writing, light on memory.',
  }),
  m({
    id: 'llama-3.2-1b', name: 'Llama 3.2 1B', family: 'llama', paramsB: 1.24, uncensored: false, agent: false,
    repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    sizeBytes: 807694464, sha256: '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83',
    license: 'llama3.2', released: '2024-09', tags: ['1B', 'Q4_K_M', '808 MB'],
    arch: { blocks: 16, kvHeads: 8, keyLength: 64, valueLength: 64 }, trainedContext: 131072,
    blurb: 'Meta Llama 3.2 in its smallest size. Solid general chat.',
  }),
  m({
    id: 'qwen2.5-1.5b', name: 'Qwen 2.5 1.5B', family: 'qwen', paramsB: 1.54, uncensored: false, agent: false,
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    sizeBytes: 1117320736, sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
    license: 'apache-2.0', released: '2024-09', tags: ['1.5B', 'Q4_K_M', '1.1 GB'],
    arch: { blocks: 28, kvHeads: 2, keyLength: 128, valueLength: 128 }, trainedContext: 32768,
    blurb: 'Very memory friendly for its size, so it leaves room for long chats.',
  }),
  m({
    id: 'qwen3-1.7b', name: 'Qwen3 1.7B', family: 'qwen', paramsB: 1.7, uncensored: false, agent: true,
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    filename: 'Qwen3-1.7B-Q4_K_M.gguf',
    sizeBytes: 1107409472, sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
    license: 'apache-2.0', released: '2025-04', tags: ['1.7B', 'Q4_K_M', '1.1 GB'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 40960, thinking: true,
    blurb: 'Can think step by step. Good balance on mid range phones.',
  }),
  m({
    id: 'qwen3.5-2b', name: 'Qwen 3.5 2B', family: 'qwen', paramsB: 2.0, uncensored: false, agent: true,
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    sizeBytes: 1280835840, sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    license: 'apache-2.0', released: '2026-03', tags: ['2B', 'Q4_K_M', '1.3 GB'],
    arch: { blocks: 24, kvHeads: 2, keyLength: 256, valueLength: 256 }, trainedContext: 262144, kvMeasured: 12288, thinking: true,
    blurb: 'Newest 2B Qwen. Strong for its size, a good match for phones with 8 GB.',
  }),
  m({
    id: 'smollm3-3b', name: 'SmolLM3 3B', family: 'smollm', paramsB: 3.08, uncensored: false, agent: true,
    repo: 'bartowski/HuggingFaceTB_SmolLM3-3B-GGUF',
    filename: 'HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf',
    sizeBytes: 1915305792, sha256: '519732558d5fa7420ab058e1b776dcfe73da78013c2fe59c7ca43c325ef89132',
    license: 'apache-2.0', released: '2025-07', tags: ['3B', 'Q4_K_M', '1.9 GB'],
    arch: { blocks: 36, kvHeads: 4, keyLength: 128, valueLength: 128 }, trainedContext: 65536, thinking: true,
    blurb: 'Compact 3B model with optional reasoning. Speaks several languages.',
  }),
  m({
    id: 'llama-3.2-3b', name: 'Llama 3.2 3B', family: 'llama', paramsB: 3.21, uncensored: false, agent: true,
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeBytes: 2019377696, sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
    license: 'llama3.2', released: '2024-09', tags: ['3B', 'Q4_K_M', '2.0 GB'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 131072,
    blurb: 'Meta Llama 3.2 3B. Reliable all rounder for phones with plenty of memory.',
  }),
  m({
    id: 'gemma-3-4b', name: 'Gemma 3 4B', family: 'gemma', paramsB: 3.88, uncensored: false, agent: false,
    repo: 'unsloth/gemma-3-4b-it-GGUF',
    filename: 'gemma-3-4b-it-Q4_K_M.gguf',
    sizeBytes: 2489894016, sha256: '04a43a22e8d2003deda5acc262f68ec1005fa76c735a9962a8c77042a74a7d19',
    license: 'gemma', released: '2025-03', tags: ['4B', 'Q4_K_M', '2.5 GB'],
    arch: { blocks: 34, kvHeads: 4, keyLength: 256, valueLength: 256 }, trainedContext: 131072,
    blurb: 'Google Gemma 3 4B. Strong writing, needs a high memory device.',
  }),
  m({
    id: 'phi-4-mini', name: 'Phi 4 Mini', family: 'phi', paramsB: 3.84, uncensored: false, agent: true,
    repo: 'bartowski/microsoft_Phi-4-mini-instruct-GGUF',
    filename: 'microsoft_Phi-4-mini-instruct-Q4_K_M.gguf',
    sizeBytes: 2491874688, sha256: '01999f17c39cc3074afae5e9c539bc82d45f2dd7faa3917c66cbef76fce8c0c2',
    license: 'mit', released: '2025-02', tags: ['3.8B', 'Q4_K_M', '2.5 GB'],
    arch: { blocks: 32, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 131072,
    blurb: 'Microsoft Phi 4 Mini. Good at reasoning and math, needs a high memory device.',
  }),
  m({
    id: 'qwen3-4b-2507', name: 'Qwen3 4B Instruct', family: 'qwen', paramsB: 4.02, uncensored: false, agent: true,
    repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF',
    filename: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
    sizeBytes: 2497281120, sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
    license: 'apache-2.0', released: '2025-08', tags: ['4B', 'Q4_K_M', '2.5 GB'],
    arch: { blocks: 36, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 262144,
    blurb: 'Strong 4B model with tool calling. Needs a high memory device.',
  }),
  m({
    id: 'qwen3.5-4b', name: 'Qwen 3.5 4B', family: 'qwen', paramsB: 4.0, uncensored: false, agent: true,
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2740937888, sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    license: 'apache-2.0', released: '2026-03', tags: ['4B', 'Q4_K_M', '2.7 GB'],
    arch: { blocks: 32, kvHeads: 4, keyLength: 256, valueLength: 256 }, trainedContext: 262144, kvMeasured: 32768, thinking: true,
    blurb: 'Newest 4B Qwen. The strongest local chat model in this list, for high memory devices.',
  }),
  m({
    id: 'gemma-4-e2b', name: 'Gemma 4 E2B', family: 'gemma', paramsB: 2.0, uncensored: false, agent: true,
    repo: 'unsloth/gemma-4-E2B-it-GGUF',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    sizeBytes: 3106738272, sha256: '740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8',
    license: 'apache-2.0', released: '2026-04', tags: ['E2B', 'Q4_K_M', '3.1 GB'],
    arch: { blocks: 35, kvHeads: 1, keyLength: 512, valueLength: 512 }, trainedContext: 131072, kvMeasured: 18432,
    blurb: 'Google Gemma 4 for devices. Large file, for tablets and phones with a lot of memory.',
  }),

  // Uncensored: abliterated builds and models trained to answer without refusals.
  m({
    id: 'qwen2.5-0.5b-abliterated', name: 'Qwen 2.5 0.5B Abliterated', family: 'qwen', paramsB: 0.49, uncensored: true, agent: false,
    repo: 'mradermacher/Qwen2.5-0.5B-Instruct-abliterated-GGUF',
    filename: 'Qwen2.5-0.5B-Instruct-abliterated.Q4_K_M.gguf',
    sizeBytes: 397808512, sha256: 'eddb18fbeee320a9eca35cefc88efdb938d9ebe106922f3d91e261f3cbc1c9f6',
    license: 'apache-2.0', released: '2024-10', tags: ['0.5B', 'Q4_K_M', '398 MB', 'Unfiltered'],
    arch: { blocks: 24, kvHeads: 2, keyLength: 64, valueLength: 64 }, trainedContext: 32768,
    blurb: 'Smallest model without refusals. Runs on almost any supported device.',
  }),
  m({
    id: 'qwen3.5-0.8b-abliterated', name: 'Qwen 3.5 0.8B Abliterated', family: 'qwen', paramsB: 0.8, uncensored: true, agent: false,
    repo: 'mradermacher/Huihui-Qwen3.5-0.8B-abliterated-GGUF',
    filename: 'Huihui-Qwen3.5-0.8B-abliterated.Q4_K_M.gguf',
    sizeBytes: 527503840, sha256: '411e0f945a5d57c63f33bcb5bfa4d5c2711d1ce28cb7635201ac0c311a7dfdf0',
    license: 'apache-2.0', released: '2026-03', tags: ['0.8B', 'Q4_K_M', '528 MB', 'Unfiltered'],
    arch: { blocks: 24, kvHeads: 2, keyLength: 256, valueLength: 256 }, trainedContext: 262144, kvMeasured: 12288, thinking: true,
    blurb: 'Newest small Qwen without refusals. Light on memory.',
  }),
  m({
    id: 'gemma-3-1b-abliterated', name: 'Gemma 3 1B Abliterated', family: 'gemma', paramsB: 1.0, uncensored: true, agent: false,
    repo: 'bartowski/huihui-ai_gemma-3-1b-it-abliterated-GGUF',
    filename: 'huihui-ai_gemma-3-1b-it-abliterated-Q4_K_M.gguf',
    sizeBytes: 806058592, sha256: '0760a54504d7529daf65f2a5de0692e773313685f50dd7f7eece2dae0dc28338',
    license: 'gemma', released: '2025-03', tags: ['1B', 'Q4_K_M', '806 MB', 'Unfiltered'],
    arch: { blocks: 26, kvHeads: 1, keyLength: 256, valueLength: 256 }, trainedContext: 32768,
    blurb: 'Gemma 3 1B without refusals.',
  }),
  m({
    id: 'dolphin3-llama3.2-1b', name: 'Dolphin 3.0 Llama 3.2 1B', family: 'llama', paramsB: 1.24, uncensored: true, agent: false,
    repo: 'bartowski/Dolphin3.0-Llama3.2-1B-GGUF',
    filename: 'Dolphin3.0-Llama3.2-1B-Q4_K_M.gguf',
    sizeBytes: 807697440, sha256: '7ed39ee0638e18d3e47bf12e60e917c792ca5332606a72bd1882ab1f62a13a7a',
    license: 'llama3.2', released: '2025-01', tags: ['1B', 'Q4_K_M', '808 MB', 'Unfiltered'],
    arch: { blocks: 16, kvHeads: 8, keyLength: 64, valueLength: 64 }, trainedContext: 131072,
    blurb: 'Dolphin 3.0, trained to answer without refusals. Smallest size.',
  }),
  m({
    id: 'dolphin3-qwen2.5-1.5b', name: 'Dolphin 3.0 Qwen 2.5 1.5B', family: 'qwen', paramsB: 1.54, uncensored: true, agent: false,
    repo: 'bartowski/Dolphin3.0-Qwen2.5-1.5B-GGUF',
    filename: 'Dolphin3.0-Qwen2.5-1.5B-Q4_K_M.gguf',
    sizeBytes: 986051648, sha256: '7caa630a60c8831a509e2663e1761355fa24bcf6ccc03e3cc767e5b5747a3be5',
    license: 'apache-2.0', released: '2025-01', tags: ['1.5B', 'Q4_K_M', '986 MB', 'Unfiltered'],
    arch: { blocks: 28, kvHeads: 2, keyLength: 128, valueLength: 128 }, trainedContext: 131072,
    blurb: 'Dolphin 3.0 without refusals. Very memory friendly for its size.',
  }),
  m({
    id: 'qwen2.5-1.5b-abliterated', name: 'Qwen 2.5 1.5B Abliterated', family: 'qwen', paramsB: 1.54, uncensored: true, agent: false,
    repo: 'mradermacher/Qwen2.5-1.5B-Instruct-abliterated-GGUF',
    filename: 'Qwen2.5-1.5B-Instruct-abliterated.Q4_K_M.gguf',
    sizeBytes: 986049088, sha256: '59aa9f44bde5349dbe292d7024d197db605f422b8baf65f3246a59abbde4e8e9',
    license: 'apache-2.0', released: '2024-10', tags: ['1.5B', 'Q4_K_M', '986 MB', 'Unfiltered'],
    arch: { blocks: 28, kvHeads: 2, keyLength: 128, valueLength: 128 }, trainedContext: 32768,
    blurb: 'Qwen 2.5 1.5B without refusals. Leaves room for long chats.',
  }),
  m({
    id: 'qwen3-1.7b-abliterated', name: 'Qwen3 1.7B Abliterated', family: 'qwen', paramsB: 1.7, uncensored: true, agent: true,
    repo: 'mradermacher/Qwen3-1.7B-abliterated-GGUF',
    filename: 'Qwen3-1.7B-abliterated.Q4_K_M.gguf',
    sizeBytes: 1107409024, sha256: '6fb5977ef935e2a54c0bd5ec45e841d5ba4256b2223c25b4f707553abac8f448',
    license: 'apache-2.0', released: '2025-05', tags: ['1.7B', 'Q4_K_M', '1.1 GB', 'Unfiltered'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 40960, thinking: true,
    blurb: 'Qwen3 1.7B without refusals. Can think step by step.',
  }),
  m({
    id: 'qwen3.5-2b-abliterated', name: 'Qwen 3.5 2B Abliterated', family: 'qwen', paramsB: 2.0, uncensored: true, agent: true,
    repo: 'mradermacher/Huihui-Qwen3.5-2B-abliterated-GGUF',
    filename: 'Huihui-Qwen3.5-2B-abliterated.Q4_K_M.gguf',
    sizeBytes: 1270809024, sha256: 'aa25eea787afe56a097268f7ed3460cb623e1901d2e89cd2b654cabb42f80636',
    license: 'apache-2.0', released: '2026-03', tags: ['2B', 'Q4_K_M', '1.3 GB', 'Unfiltered'],
    arch: { blocks: 24, kvHeads: 2, keyLength: 256, valueLength: 256 }, trainedContext: 262144, kvMeasured: 12288, thinking: true,
    blurb: 'Newest 2B Qwen without refusals. A good match for phones with 8 GB.',
  }),
  m({
    id: 'dolphin3-llama3.2-3b', name: 'Dolphin 3.0 Llama 3.2 3B', family: 'llama', paramsB: 3.21, uncensored: true, agent: true,
    repo: 'bartowski/Dolphin3.0-Llama3.2-3B-GGUF',
    filename: 'Dolphin3.0-Llama3.2-3B-Q4_K_M.gguf',
    sizeBytes: 2019382400, sha256: '5d6d02eeefa1ab5dbf23f97afdf5c2c95ad3d946dc3b6e9ab72e6c1637d54177',
    license: 'llama3.2', released: '2025-01', tags: ['3B', 'Q4_K_M', '2.0 GB', 'Unfiltered'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 131072,
    blurb: 'Dolphin 3.0 3B, trained to answer without refusals.',
  }),
  m({
    id: 'hermes-3-llama3.2-3b', name: 'Hermes 3 Llama 3.2 3B', family: 'llama', paramsB: 3.21, uncensored: true, agent: true,
    repo: 'mradermacher/Hermes-3-Llama-3.2-3B-GGUF',
    filename: 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf',
    sizeBytes: 2019374336, sha256: '8b7edcf0bfce2fe94ea813946254d5bdb03acc6a5aca8e86baa8910c46c2b970',
    license: 'llama3', released: '2024-12', tags: ['3B', 'Q4_K_M', '2.0 GB', 'Unfiltered'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 131072,
    blurb: 'NousResearch Hermes 3. Few refusals and native tool calling.',
  }),
  m({
    id: 'llama-3.2-3b-abliterated', name: 'Llama 3.2 3B Abliterated', family: 'llama', paramsB: 3.21, uncensored: true, agent: true,
    repo: 'mradermacher/Llama-3.2-3B-Instruct-abliterated-GGUF',
    filename: 'Llama-3.2-3B-Instruct-abliterated.Q4_K_M.gguf',
    sizeBytes: 2241004512, sha256: '3a8ad1732ca90048bc5ecf44dcb3b789469e8a68d389ab79516853bf0d27ad34',
    license: 'llama3.2', released: '2024-10', tags: ['3B', 'Q4_K_M', '2.2 GB', 'Unfiltered'],
    arch: { blocks: 28, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 131072,
    blurb: 'Llama 3.2 3B without refusals.',
  }),
  m({
    id: 'gemma-3-4b-abliterated', name: 'Gemma 3 4B Abliterated', family: 'gemma', paramsB: 3.88, uncensored: true, agent: false,
    repo: 'bartowski/mlabonne_gemma-3-4b-it-abliterated-GGUF',
    filename: 'mlabonne_gemma-3-4b-it-abliterated-Q4_K_M.gguf',
    sizeBytes: 2489894304, sha256: '1b18347ba3e998aa2fd4e21172369daa2f772aa0a228e3ed9136378346ccf3b7',
    license: 'gemma', released: '2025-03', tags: ['4B', 'Q4_K_M', '2.5 GB', 'Unfiltered'],
    arch: { blocks: 34, kvHeads: 4, keyLength: 256, valueLength: 256 }, trainedContext: 131072,
    blurb: 'Gemma 3 4B without refusals. Needs a high memory device.',
  }),
  m({
    id: 'qwen3-4b-2507-abliterated', name: 'Qwen3 4B Instruct Abliterated', family: 'qwen', paramsB: 4.02, uncensored: true, agent: true,
    repo: 'mradermacher/Huihui-Qwen3-4B-Instruct-2507-abliterated-GGUF',
    filename: 'Huihui-Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf',
    sizeBytes: 2497281312, sha256: 'b1324e2f1bd2e0610d591f54f93e38d90b187f69d1f215f4cace349eade678d7',
    license: 'apache-2.0', released: '2025-08', tags: ['4B', 'Q4_K_M', '2.5 GB', 'Unfiltered'],
    arch: { blocks: 36, kvHeads: 8, keyLength: 128, valueLength: 128 }, trainedContext: 262144,
    blurb: 'Qwen3 4B without refusals, with tool calling. Needs a high memory device.',
  }),
  m({
    id: 'qwen3.5-4b-abliterated', name: 'Qwen 3.5 4B Abliterated', family: 'qwen', paramsB: 4.0, uncensored: true, agent: true,
    repo: 'mradermacher/Huihui-Qwen3.5-4B-abliterated-GGUF',
    filename: 'Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf',
    sizeBytes: 2707514688, sha256: '423f10b6ec2d99c3378143d7cd3b80eb4887b3ed92103103ac59173b404f4f7c',
    license: 'apache-2.0', released: '2026-03', tags: ['4B', 'Q4_K_M', '2.7 GB', 'Unfiltered'],
    arch: { blocks: 32, kvHeads: 4, keyLength: 256, valueLength: 256 }, trainedContext: 262144, kvMeasured: 32768, thinking: true,
    blurb: 'Newest 4B Qwen without refusals. For high memory devices.',
  }),
]

/**
 * Embedding model for Document Chat. Same file as the desktop
 * (`ONBOARDING_EMBED_MODEL` in lib/constants.ts): nomic-embed-text v1.5,
 * Q4_K_M, 768 dimensions. Size and digest from the HF LFS metadata, HEAD 200
 * on 2026-10-08. License apache-2.0 (model card).
 */
export const MOBILE_EMBED_MODEL = {
  id: 'nomic-embed-text-v1.5',
  name: 'Nomic Embed Text v1.5',
  repo: 'nomic-ai/nomic-embed-text-v1.5-GGUF',
  downloadUrl: HF('nomic-ai/nomic-embed-text-v1.5-GGUF', 'nomic-embed-text-v1.5.Q4_K_M.gguf'),
  filename: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
  sizeBytes: 84106624,
  expectedBytes: 84106624,
  sizeGB: 84106624 / GIB,
  sha256: 'd4e388894e09cf3816e8b0896d81d265b55e7a9fff9ab03fe8bf4ef5e11295ac',
  license: 'apache-2.0',
  quant: 'Q4_K_M',
  /** `nomic-bert.context_length` from the GGUF header. */
  trainedContext: 2048,
} as const

export function mobileModelById(id: string): MobileModel | undefined {
  return MOBILE_CHAT_MODELS.find((model) => model.id === id)
}

/** The quantization a GGUF file name carries ("Q4_K_M", "IQ2_M", "BF16"), in capitals. Undefined when it names none. */
const FILE_QUANT = /(IQ\d_[A-Z0-9]+|Q\d_K(?:_[A-Z]+)?|Q\d_[01]|BF16|F16|F32)/i

export function quantOfFileName(name: string): string | undefined {
  return FILE_QUANT.exec(name)?.[1]?.toUpperCase()
}

/**
 * What a GGUF file name says about the model without how it is packed:
 * "Qwen3.5-2B-UD-IQ2_M.gguf" and "Qwen3.5-2B-Q4_K_M.gguf" are both
 * "qwen3.5-2b". Folder, ending, the quantization and the marks packers put
 * in front of it (UD, i1, imat) are dropped, the rest is lower case.
 */
export function modelFileStem(filename: string): string {
  const leaf = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.gguf$/i, '')
  const hit = FILE_QUANT.exec(leaf)
  const head = hit ? leaf.slice(0, hit.index) : leaf
  return head
    .replace(/[-_. ]+$/, '')
    .replace(/[-_. ](?:ud|i1|imat|imatrix)$/i, '')
    .replace(/[-_. ]+$/, '')
    .toLowerCase()
}

const CATALOG_BY_FILE: ReadonlyMap<string, MobileModel> = new Map(MOBILE_CHAT_MODELS.map((model) => [model.filename.toLowerCase(), model]))
const CATALOG_BY_STEM: ReadonlyMap<string, MobileModel> = new Map([...MOBILE_CHAT_MODELS].reverse().map((model) => [modelFileStem(model.filename), model]))

export interface CatalogFileMatch {
  model: MobileModel
  /** True for the file the catalogue lists itself, false for another quantization of the same model. */
  exact: boolean
  /** The quantization of THIS file. */
  quant: string | undefined
}

/**
 * The catalogue model a file on the phone belongs to, for every way the same
 * model is packed. The detail page offers the other quantizations of a
 * catalogue model next to the listed one (IQ2_M, Q8_0), and once such a file
 * is on the phone it must stay the same model: same shape for the fit
 * verdict, same marks (Thinking, Tools, No Filter). Acceptance Android,
 * re-run, N1: the IQ2_M file of Qwen 3.5 2B was "tight" before the download
 * and "too large" and without marks after it, because only the exact file
 * name was looked up.
 */
export function catalogModelForFile(filename: string): CatalogFileMatch | undefined {
  const leaf = filename.split(/[\\/]/).pop() ?? filename
  const withEnding = /\.gguf$/i.test(leaf) ? leaf : `${leaf}.gguf`
  const listed = CATALOG_BY_FILE.get(withEnding.toLowerCase())
  if (listed) return { model: listed, exact: true, quant: listed.quant }
  const stem = modelFileStem(leaf)
  const family = stem ? CATALOG_BY_STEM.get(stem) : undefined
  return family ? { model: family, exact: false, quant: quantOfFileName(leaf) } : undefined
}

export interface MobileRecommendation {
  /** What onboarding proposes first. LU recommends models without refusals, like the desktop onboarding. */
  uncensored: string
  /**
   * The proposal that is NOT listed as abliterated or uncensored
   * (`unfiltered: false`). It is the only proposal when the store policy
   * switches the unfiltered catalog off (`unfilteredCatalog === false`).
   */
  mainstream: string
}

/**
 * Models that must never be an onboarding proposal, with the reason. All
 * three answered "Count from 1 to 10." wrongly on every compute path of the
 * measurement run (KATALOG-PROBE.md section 3, "Was nicht ja ist"). They load
 * and compute correctly, so they stay in the catalog.
 */
export const NOT_RECOMMENDED: Readonly<Record<string, string>> = {
  'smollm2-360m': 'Writes a Python program instead of counting.',
  'gemma-3-1b-abliterated': 'Repeats the question and stops.',
  'qwen2.5-1.5b-abliterated': 'Repeats the question and stops.',
}

/** May this model be proposed in the onboarding. */
export function mayBeRecommended(id: string): boolean {
  return !(id in NOT_RECOMMENDED)
}

/**
 * Onboarding proposal per RAM class: a model of each kind that answered both
 * questions of the measurement run correctly on Metal, on Metal without the
 * tensor API, on the processor and with the doubled context, and whose
 * verdict is `fits` (not merely `tight`) on EVERY device of the class at the
 * class default context, without the entitlement. iOS and Android differ
 * where their assumed limits differ.
 *
 * Two entries are `tight` instead of `fits`, see TIGHT_RECOMMENDATIONS.
 *
 * Why not Qwen 3.5 2B for 8 GB: in three of four runs it spent 700 tokens
 * thinking about "Count from 1 to 10." and never finished the answer. Qwen3
 * 1.7B thinks 117 to 344 tokens and answered in every run. For 6 GB Dolphin
 * 3.0 Qwen 2.5 1.5B replaces Qwen 2.5 1.5B Abliterated: same file size, same
 * KV cache, and it counts.
 *
 * src/mobile/lib/__tests__/device-fit.test.ts pins this: every id exists and
 * fits its class. Change a limit in device-memory.ts and the test says which
 * line here has to move.
 */
export const MOBILE_RECOMMENDATIONS: Record<MobilePlatform, Record<number, MobileRecommendation>> = {
  ios: {
    2: { uncensored: 'qwen2.5-0.5b-abliterated', mainstream: 'qwen3.5-0.8b' },
    3: { uncensored: 'qwen3.5-0.8b-abliterated', mainstream: 'qwen3.5-0.8b' },
    4: { uncensored: 'qwen3.5-0.8b-abliterated', mainstream: 'qwen3.5-0.8b' },
    6: { uncensored: 'dolphin3-qwen2.5-1.5b', mainstream: 'qwen2.5-1.5b' },
    // 12 and 16 GB repeat 8 GB: without the entitlement their assumed limit is the same.
    8: { uncensored: 'qwen3-1.7b-abliterated', mainstream: 'qwen3-1.7b' },
    12: { uncensored: 'qwen3-1.7b-abliterated', mainstream: 'qwen3-1.7b' },
    16: { uncensored: 'qwen3-1.7b-abliterated', mainstream: 'qwen3-1.7b' },
  },
  android: {
    3: { uncensored: 'qwen2.5-0.5b-abliterated', mainstream: 'qwen3.5-0.8b' },
    4: { uncensored: 'qwen3.5-0.8b-abliterated', mainstream: 'qwen3.5-0.8b' },
    6: { uncensored: 'dolphin3-qwen2.5-1.5b', mainstream: 'qwen2.5-1.5b' },
    8: { uncensored: 'qwen3-1.7b-abliterated', mainstream: 'qwen3-1.7b' },
    12: { uncensored: 'qwen3.5-4b-abliterated', mainstream: 'qwen3.5-4b' },
    16: { uncensored: 'qwen3.5-4b-abliterated', mainstream: 'qwen3.5-4b' },
  },
}

/**
 * The proposals that are only `tight` on their class, as `platform:ramGb:kind`.
 *
 * On the smallest class of each platform (2 GB iPad, 3 GB Android) the only
 * mainstream model that fits comfortably is SmolLM2 360M, and that one is in
 * NOT_RECOMMENDED. Qwen 3.5 0.8B is the smallest mainstream model that
 * answers correctly. It needs about 984 MB where 897 MB (iOS) and 845 MB
 * (Android) would be comfortable and 1104 MB and 1040 MB are the budget, so
 * it runs, with the "tight" warning the fit verdict gives it.
 */
export const TIGHT_RECOMMENDATIONS: ReadonlySet<string> = new Set(['ios:2:mainstream', 'android:3:mainstream'])

/**
 * Recommendation for a device. `ramGb` may be the nominal or the reported
 * figure, it is mapped to its class like everywhere else (ramClassFor). Below
 * the smallest class there is no recommendation.
 */
export function recommendedModelsFor(platform: MobilePlatform, ramGb: number): { uncensored: MobileModel; mainstream: MobileModel } | undefined {
  const row = ramClassFor(platform, ramGb)
  const rec = row ? MOBILE_RECOMMENDATIONS[platform][row.ramGb] : undefined
  if (!rec) return undefined
  const uncensored = mobileModelById(rec.uncensored)
  const mainstream = mobileModelById(rec.mainstream)
  return uncensored && mainstream ? { uncensored, mainstream } : undefined
}

function sizeLabel(bytes: number): string {
  return bytes < GIB ? `${Math.round(bytes / 1_048_576)} MiB` : `${(bytes / GIB).toFixed(1)} GiB`
}

/**
 * The onboarding shape of the desktop (`OnboardingModel`). `vramGB` is 0 on
 * purpose: a phone has no separate graphics memory, the verdict comes from
 * lib/device-fit.ts, and the mobile onboarding must not run the desktop's
 * VRAM comparison on it.
 */
export function toOnboardingModel(model: MobileModel, recommended = false): OnboardingModel {
  return {
    name: model.id,
    label: model.name,
    description: model.description,
    size: sizeLabel(model.sizeBytes),
    vram: 'runs in device memory',
    vramGB: 0,
    recommended,
    uncensored: model.uncensored,
    agent: model.agent ?? false,
    downloadUrl: model.downloadUrl,
    filename: model.filename,
    sizeGB: model.sizeGB,
    expectedBytes: model.expectedBytes,
    sha256: model.sha256,
  }
}
