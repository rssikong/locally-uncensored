/**
 * A LoRA from a pasted link (GitHub wish G2): what the link names, what the
 * host says about the file behind it, and whether LU takes it.
 *
 * Pure. The fetching lives in `api/lora-link.ts`, so every rule here is
 * tested against stored answers of the two hosts, with no network.
 *
 * Two hosts and nothing else, both over https:
 *  - CivitAI: `civitai.com/models/<id>[/<slug>][?modelVersionId=<v>]`, without
 *    a version the newest one. Also `civitai.com/api/download/models/<v>`,
 *    the address its own Download button copies.
 *  - Hugging Face: `huggingface.co/<owner>/<repo>/(blob|resolve)/<rev>/<path>`
 *    of a `.safetensors` file.
 *
 * Nothing is guessed. A CivitAI model that is not a LoRA is refused, a base
 * model LU does not know is named as such, and a Hugging Face file whose page
 * does not say it is a LoRA is downloaded only after the user has read that.
 */
import { asNumber, asRecordArray, asString, asStringArray, isRecord, prop } from '../types/json-guards'
import { formatBytes } from './formatters'

export type LoraLinkRef =
  | { kind: 'civitai'; modelId?: number; versionId?: number }
  | { kind: 'hf'; repo: string; rev: string; path: string }

/** What the link is, or the sentence that says why LU does not take it. */
export type LoraLinkParse = { ok: true; ref: LoraLinkRef } | { ok: false; error: string }

export const LORA_LINK_HOSTS_HINT = 'Paste a link to a LoRA on civitai.com or huggingface.co.'

const POSITIVE_INT = /^[1-9]\d{0,11}$/

function asId(s: string | null | undefined): number | undefined {
  return s && POSITIVE_INT.test(s) ? Number(s) : undefined
}

/** Reads a pasted link. Only `https://civitai.com` (and `www.`) and
 *  `https://huggingface.co` (and `www.`) pass. */
export function parseLoraLink(input: string): LoraLinkParse {
  const text = input.trim()
  if (!text) return { ok: false, error: LORA_LINK_HOSTS_HINT }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, error: `This is not a link. ${LORA_LINK_HOSTS_HINT}` }
  }
  const host = url.hostname.toLowerCase()
  const civitai = host === 'civitai.com' || host === 'www.civitai.com'
  const hf = host === 'huggingface.co' || host === 'www.huggingface.co'
  if (!civitai && !hf) return { ok: false, error: `LU takes LoRA links from civitai.com and huggingface.co only. ${LORA_LINK_HOSTS_HINT}` }
  if (url.protocol !== 'https:') return { ok: false, error: 'Only https links are taken. Copy the link from the address bar of your browser.' }
  if (url.username || url.password || (url.port && url.port !== '443')) {
    return { ok: false, error: `This link carries a user name or a port. ${LORA_LINK_HOSTS_HINT}` }
  }
  const segs = url.pathname.split('/').filter(Boolean)

  if (civitai) {
    if (segs[0] === 'models' && segs[1]) {
      const modelId = asId(segs[1])
      if (modelId === undefined) return { ok: false, error: 'This CivitAI link names no model number. Open the LoRA on CivitAI and copy the link again.' }
      const v = url.searchParams.get('modelVersionId')
      if (v !== null && asId(v) === undefined) return { ok: false, error: 'The version number in this CivitAI link is not a number.' }
      return { ok: true, ref: { kind: 'civitai', modelId, versionId: asId(v) } }
    }
    if (segs[0] === 'api' && segs[1] === 'download' && segs[2] === 'models' && segs.length === 4) {
      const versionId = asId(segs[3])
      if (versionId !== undefined) return { ok: true, ref: { kind: 'civitai', versionId } }
    }
    return { ok: false, error: 'This CivitAI link is not a model page. Open the LoRA on CivitAI and copy the link of its page.' }
  }

  // huggingface.co/<owner>/<repo>/(blob|resolve)/<rev>/<path...>
  if (segs.length < 5 || (segs[2] !== 'blob' && segs[2] !== 'resolve')) {
    return { ok: false, error: 'This Hugging Face link names no file. Open the .safetensors file on Hugging Face and copy its link.' }
  }
  let decoded: string[]
  try {
    decoded = segs.map((s) => decodeURIComponent(s))
  } catch {
    return { ok: false, error: 'This Hugging Face link could not be read.' }
  }
  if (decoded.some((s) => s === '..' || s === '.' || s.includes('/') || s.includes('\\'))) {
    return { ok: false, error: 'This Hugging Face link could not be read.' }
  }
  const [owner, repo, , rev, ...rest] = decoded
  const path = rest.join('/')
  if (!/\.safetensors$/i.test(path)) {
    return { ok: false, error: 'LU loads LoRAs as .safetensors files only, and this link names another kind of file.' }
  }
  return { ok: true, ref: { kind: 'hf', repo: `${owner}/${repo}`, rev, path } }
}

// ─── Base models ───

/** The base models LU knows by name. `null` from the readers below means
 *  "not one of these", which the panel says in so many words. */
export type LoraFamily =
  | 'SD 1.5' | 'SD 2' | 'SDXL' | 'SD 3.5'
  | 'FLUX.1' | 'FLUX.2 dev' | 'FLUX.2 klein 4B' | 'FLUX.2 klein 9B'
  | 'Z-Image' | 'Qwen-Image' | 'Qwen-Image 2.1'
  | 'Wan 2.1' | 'Wan 2.2' | 'Wan 2.5'
  | 'Hunyuan Video' | 'LTX Video' | 'LTX-2' | 'Chroma' | 'HiDream'

/** The families the Mac's image engine runs a LoRA with (`MAC_LORA_MODEL_FAMILIES`
 *  in api/mlx-loras: Qwen-Image 2.1, Qwen-Image 2512, Z-Image Turbo, FLUX.2
 *  klein 4B). Kept here as families so this module needs no app import. */
export const MAC_LORA_FAMILIES: readonly LoraFamily[] = ['Qwen-Image 2.1', 'Qwen-Image', 'Z-Image', 'FLUX.2 klein 4B']

/** CivitAI's `baseModel` field, as measured on 15.10.2026 ("SDXL 1.0",
 *  "Illustrious", "ZImageTurbo", "Qwen 2.1", "Wan Video 2.2 T2V-A14B" ...). */
export function civitaiBaseFamily(raw: string | undefined): LoraFamily | null {
  if (!raw) return null
  const s = raw.trim().toLowerCase()
  if (/^sd 1\.[45]\b/.test(s)) return 'SD 1.5'
  if (/^sd 2\.[01]\b/.test(s)) return 'SD 2'
  if (/^sdxl\b/.test(s) || s === 'pony' || s === 'illustrious' || s === 'noobai') return 'SDXL'
  if (/^sd 3(\.5)?\b/.test(s)) return 'SD 3.5'
  if (/^flux\.1\b/.test(s)) return 'FLUX.1'
  if (/^flux\.2 klein 4b\b/.test(s)) return 'FLUX.2 klein 4B'
  if (/^flux\.2 klein 9b\b/.test(s)) return 'FLUX.2 klein 9B'
  if (s === 'flux.2 d') return 'FLUX.2 dev'
  if (/^z-?image ?(turbo|base)?$/.test(s) || /^zimage(turbo|base)$/.test(s)) return 'Z-Image'
  if (s === 'qwen 2.1') return 'Qwen-Image 2.1'
  if (s === 'qwen') return 'Qwen-Image'
  const wan = /^wan video(?: (\d\.\d))?\b/.exec(s)
  if (wan) {
    if (!wan[1]) return 'Wan 2.1'
    if (wan[1] === '2.2') return 'Wan 2.2'
    if (wan[1] === '2.5') return 'Wan 2.5'
    return null
  }
  if (s === 'hunyuan video') return 'Hunyuan Video'
  if (s === 'ltxv') return 'LTX Video'
  if (/^ltxv ?2/.test(s)) return 'LTX-2'
  if (s === 'chroma') return 'Chroma'
  if (s === 'hidream') return 'HiDream'
  return null
}

/** A Hugging Face `base_model` (a repo id such as
 *  `stabilityai/stable-diffusion-xl-base-1.0`). Only names that say the
 *  family outright count. */
export function hfBaseFamily(repoId: string | undefined): LoraFamily | null {
  if (!repoId) return null
  const s = repoId.trim().toLowerCase()
  const name = s.split('/').pop() ?? s
  if (name.includes('stable-diffusion-xl') || /(^|[-_])sdxl([-_]|$)/.test(name)) return 'SDXL'
  if (/stable-diffusion-v1-[45]/.test(name)) return 'SD 1.5'
  if (/stable-diffusion-2/.test(name)) return 'SD 2'
  if (/stable-diffusion-3/.test(name)) return 'SD 3.5'
  if (name.startsWith('flux.1')) return 'FLUX.1'
  if (name.startsWith('flux.2-klein-4b')) return 'FLUX.2 klein 4B'
  if (name.startsWith('flux.2-klein-9b')) return 'FLUX.2 klein 9B'
  if (name.startsWith('flux.2-dev')) return 'FLUX.2 dev'
  if (name.startsWith('z-image')) return 'Z-Image'
  if (name.startsWith('qwen-image-2.1')) return 'Qwen-Image 2.1'
  if (name.startsWith('qwen-image')) return 'Qwen-Image'
  if (/^wan2\.1/.test(name)) return 'Wan 2.1'
  if (/^wan2\.2/.test(name)) return 'Wan 2.2'
  if (name.startsWith('hunyuanvideo')) return 'Hunyuan Video'
  if (name.startsWith('ltx-video')) return 'LTX Video'
  if (name.startsWith('ltx-2')) return 'LTX-2'
  if (name.startsWith('chroma')) return 'Chroma'
  if (name.startsWith('hidream')) return 'HiDream'
  return null
}

// ─── What the hosts answer ───

/** One LoRA, ready to be shown and downloaded. */
export interface LoraLinkInfo {
  source: 'civitai' | 'hf'
  /** What the panel calls it. */
  name: string
  /** The host's own word for the base model, as it stands there. */
  baseModelRaw?: string
  /** The family LU reads from it, or null when LU does not know it. */
  family: LoraFamily | null
  filename: string
  sizeBytes?: number
  /** Lower case hex, when the host states it. */
  sha256?: string
  downloadUrl: string
  /** The page the user came from, for "View page". */
  pageUrl: string
  /** Notes the user reads before the Download button means anything. */
  warnings: string[]
}

export type LoraLinkResult = { ok: true; info: LoraLinkInfo } | { ok: false; error: string }

/** CivitAI's model types that the LoRA loader takes. */
const CIVITAI_LORA_TYPES = new Set(['lora', 'locon', 'dora'])

const CIVITAI_TYPE_WORDS: Record<string, string> = {
  checkpoint: 'a checkpoint',
  textualinversion: 'an embedding',
  vae: 'a VAE',
  controlnet: 'a ControlNet',
  upscaler: 'an upscaler',
  hypernetwork: 'a hypernetwork',
  aestheticgradient: 'an aesthetic gradient',
  motionmodule: 'a motion module',
  poses: 'a pose pack',
  wildcards: 'a wildcard list',
  workflows: 'a workflow',
  detection: 'a detection model',
  other: 'not marked as a LoRA',
}

function sha256Of(v: unknown): string | undefined {
  const s = asString(v)?.trim().toLowerCase()
  return s && /^[0-9a-f]{64}$/.test(s) ? s : undefined
}

/** A name a file can carry in any of the three systems: no folders, no
 *  characters Windows refuses, no leading dot. */
export function safeLoraFilename(name: string): string {
  const leaf = name.split(/[/\\]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const cleaned = leaf.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim()
  return cleaned || 'lora.safetensors'
}

/**
 * The answer of `/api/v1/model-versions/<v>` or one entry of
 * `/api/v1/models/<id>` `modelVersions`, with the model's name and type
 * beside it (the version answer carries them in `model`, the model answer
 * one level up).
 */
export function civitaiLoraFromVersion(
  version: unknown,
  model: { name?: string; type?: string; id?: number },
  host: string = 'civitai.com',
): LoraLinkResult {
  if (!isRecord(version)) return { ok: false, error: 'CivitAI sent no version for this model.' }
  const type = (model.type ?? '').trim()
  const typeKey = type.toLowerCase()
  if (!CIVITAI_LORA_TYPES.has(typeKey)) {
    const word = CIVITAI_TYPE_WORDS[typeKey] ?? (type ? `of the type "${type}"` : 'of no stated type')
    return { ok: false, error: `This CivitAI model is ${word}, not a LoRA. Nothing was downloaded.` }
  }
  const files = asRecordArray(prop(version, 'files'))
  const safetensors = files.filter((f) =>
    /\.safetensors$/i.test(asString(prop(f, 'name')) ?? '')
    && (asString(prop(f, 'type')) ?? 'Model').toLowerCase() === 'model')
  const file = safetensors.find((f) => prop(f, 'primary') === true) ?? safetensors[0]
  if (!file) {
    return { ok: false, error: 'This CivitAI version has no .safetensors file. LU loads LoRAs as .safetensors files only.' }
  }
  const versionId = asNumber(prop(version, 'id'))
  const downloadUrl = asString(prop(file, 'downloadUrl'))
    ?? (versionId ? `https://civitai.com/api/download/models/${versionId}` : undefined)
  if (!downloadUrl || !/^https:\/\/(www\.)?civitai\.com\//i.test(downloadUrl)) {
    return { ok: false, error: 'CivitAI named no download address on civitai.com for this file.' }
  }
  const sizeKB = asNumber(prop(file, 'sizeKB'))
  const raw = asString(prop(version, 'baseModel'))
  const family = civitaiBaseFamily(raw)
  const warnings: string[] = []
  if (!family) {
    warnings.push(raw
      ? `LU does not know the base model "${raw}". Check on the CivitAI page which image model this LoRA is for.`
      : 'CivitAI names no base model for this LoRA. Check on its page which image model it is for.')
  }
  const versionName = asString(prop(version, 'name'))
  const modelName = model.name?.trim() || `CivitAI model ${model.id ?? ''}`.trim()
  const modelId = model.id ?? asNumber(prop(version, 'modelId'))
  return {
    ok: true,
    info: {
      source: 'civitai',
      name: versionName && versionName !== modelName ? `${modelName} (${versionName})` : modelName,
      baseModelRaw: raw,
      family,
      filename: safeLoraFilename(asString(prop(file, 'name')) ?? ''),
      sizeBytes: sizeKB && sizeKB > 0 ? Math.round(sizeKB * 1024) : undefined,
      sha256: sha256Of(prop(prop(file, 'hashes'), 'SHA256')),
      downloadUrl: host !== 'civitai.com' ? downloadUrl.replace(/^https:\/\/(www\.)?civitai\.com/i, `https://${host}`) : downloadUrl,
      pageUrl: modelId
        ? `https://civitai.com/models/${modelId}${versionId ? `?modelVersionId=${versionId}` : ''}`
        : `https://civitai.com/`,
      warnings,
    },
  }
}

/** `/api/v1/models/<id>`: the version the link names, or the newest
 *  (CivitAI lists the newest first). */
export function civitaiLoraFromModel(model: unknown, versionId?: number, host?: string): LoraLinkResult {
  if (!isRecord(model)) return { ok: false, error: 'CivitAI sent no model for this link.' }
  const versions = asRecordArray(prop(model, 'modelVersions'))
  const version = versionId !== undefined
    ? versions.find((v) => asNumber(prop(v, 'id')) === versionId)
    : versions[0]
  if (!version) {
    return { ok: false, error: versionId !== undefined
      ? 'This model on CivitAI has no version with the number in the link.'
      : 'This model on CivitAI has no version to download.' }
  }
  return civitaiLoraFromVersion(version, {
    name: asString(prop(model, 'name')),
    type: asString(prop(model, 'type')),
    id: asNumber(prop(model, 'id')),
  }, host)
}

/** `/api/v1/model-versions/<v>`: the model's name and type sit in `model`. */
export function civitaiLoraFromVersionAnswer(answer: unknown, host?: string): LoraLinkResult {
  return civitaiLoraFromVersion(answer, {
    name: asString(prop(prop(answer, 'model'), 'name')),
    type: asString(prop(prop(answer, 'model'), 'type')),
    id: asNumber(prop(answer, 'modelId')),
  }, host)
}

/** The base models a Hugging Face model page names: `cardData.base_model`
 *  (a string or a list) and the `base_model:` tags. */
function hfBaseModels(info: unknown): string[] {
  const card = prop(prop(info, 'cardData'), 'base_model')
  const fromCard = typeof card === 'string' ? [card] : asStringArray(card)
  const fromTags = asStringArray(prop(info, 'tags'))
    .filter((t) => t.startsWith('base_model:'))
    .map((t) => t.split(':').pop() ?? '')
    .filter(Boolean)
  return [...new Set([...fromCard, ...fromTags])]
}

/** Does the page say this repository is a LoRA? Its `lora` tag, or the hub's
 *  own `base_model:adapter:` relation. Nothing else counts. */
function hfSaysLora(info: unknown): boolean {
  const tags = asStringArray(prop(info, 'tags')).map((t) => t.toLowerCase())
  return tags.includes('lora') || tags.some((t) => t.startsWith('base_model:adapter:'))
}

/** LoRAs stay well below this; above it a file the page does not call a
 *  LoRA is taken for a full model (SDXL base is 6.9 GB). */
export const HF_FULL_MODEL_BYTES = 4 * 1024 ** 3

/**
 * Why a Hugging Face file is a full model and not a LoRA, or null. Only asked
 * when the page does not say LoRA: a diffusers pipeline repo
 * (`diffusers:StableDiffusionXLPipeline`), a finetune, merge or quantization
 * of a base model, or a file the size of a checkpoint. d308-a, Windows box
 * 15.10.2026: the SDXL base link was offered as "Download anyway (6.5 GB)"
 * into the LoRA folder although the changelog promises a checkpoint is
 * refused.
 */
export function hfFullModelReason(info: unknown, sizeBytes: number | undefined): string | null {
  const tags = asStringArray(prop(info, 'tags')).map((t) => t.toLowerCase())
  if (tags.some((t) => t.startsWith('diffusers:'))) return 'a full diffusers model'
  if (tags.some((t) => /^base_model:(finetune|merge|quantized):/.test(t))) return 'a full model built on a base model'
  if (sizeBytes !== undefined && sizeBytes > HF_FULL_MODEL_BYTES) return `${formatBytes(sizeBytes)}, the size of a full model`
  return null
}

/** Builds the address that downloads exactly this file. */
export function hfResolveUrl(ref: Extract<LoraLinkRef, { kind: 'hf' }>): string {
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/')
  return `https://huggingface.co/${enc(ref.repo)}/resolve/${encodeURIComponent(ref.rev)}/${enc(ref.path)}`
}

/** The folder of the file, for `/api/models/<repo>/tree/<rev>/<folder>`. */
export function hfTreeFolder(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/**
 * `/api/models/<repo>` (the page) and `/api/models/<repo>/tree/<rev>/<folder>`
 * (the folder of the file) as one LoRA. `tree` may be null when the folder
 * listing could not be read; the file then goes without size and digest.
 */
export function hfLoraFromAnswers(
  ref: Extract<LoraLinkRef, { kind: 'hf' }>,
  info: unknown,
  tree: unknown,
): LoraLinkResult {
  const entries = Array.isArray(tree) ? asRecordArray(tree) : null
  const entry = entries?.find((e) => asString(prop(e, 'path')) === ref.path)
  if (entries && !entry) return { ok: false, error: 'This file is not in the Hugging Face repository. Check the link.' }
  const lfs = entry ? prop(entry, 'lfs') : undefined
  const size = asNumber(prop(lfs, 'size')) ?? (entry ? asNumber(prop(entry, 'size')) : undefined)
  if (!hfSaysLora(info)) {
    const full = hfFullModelReason(info, size && size > 0 ? size : undefined)
    if (full) return { ok: false, error: `This Hugging Face file is ${full}, not a LoRA. Nothing was downloaded.` }
  }
  const bases = hfBaseModels(info)
  const families = [...new Set(bases.map(hfBaseFamily).filter((f): f is LoraFamily => f !== null))]
  const warnings: string[] = []
  if (!hfSaysLora(info)) {
    warnings.push('The Hugging Face page does not say this file is a LoRA. Download it only if you know it is one.')
  }
  let family: LoraFamily | null = null
  if (families.length === 1) family = families[0]
  else if (families.length > 1) {
    warnings.push(`The page names more than one base model (${families.join(', ')}). Check which one this file is for.`)
  } else {
    warnings.push(bases.length > 0
      ? `LU does not know the base model "${bases[0]}". Check on the page which image model this LoRA is for.`
      : 'The Hugging Face page names no base model. Check on the page which image model this LoRA is for.')
  }
  const leaf = ref.path.split('/').pop() ?? ref.path
  return {
    ok: true,
    info: {
      source: 'hf',
      name: `${ref.repo}: ${leaf}`,
      baseModelRaw: bases[0],
      family,
      filename: safeLoraFilename(leaf),
      sizeBytes: size && size > 0 ? size : undefined,
      sha256: sha256Of(prop(lfs, 'oid')),
      downloadUrl: hfResolveUrl(ref),
      pageUrl: `https://huggingface.co/${ref.repo}`,
      warnings,
    },
  }
}

/** The Mac runs LoRAs for four families only; anything else would sit in the
 *  folder and never be offered. Null when the family runs there. */
export function macFamilyWarning(family: LoraFamily | null): string | null {
  if (family && MAC_LORA_FAMILIES.includes(family)) return null
  return `On this Mac, LoRAs run with ${MAC_LORA_FAMILIES.join(', ')} only.${family ? ` This one is for ${family}.` : ''}`
}

/** "SDXL (Illustrious)", "Z-Image", or the host's own word when LU does not
 *  know it. */
export function familyLabel(info: Pick<LoraLinkInfo, 'family' | 'baseModelRaw' | 'source'>): string {
  if (!info.family) return info.baseModelRaw ? `${info.baseModelRaw} (unknown to LU)` : 'Not stated'
  const raw = info.baseModelRaw?.trim()
  // CivitAI's word says more than the family when it is a fork of it
  // ("Illustrious", "Pony"); a Hugging Face repo id says nothing more.
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (info.source === 'civitai' && raw && !squash(raw).startsWith(squash(info.family))) return `${info.family} (${raw})`
  return info.family
}
