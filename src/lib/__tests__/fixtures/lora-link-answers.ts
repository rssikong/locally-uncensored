/**
 * Answers of CivitAI and Hugging Face, shortened to the fields LU reads and
 * shaped like the real ones measured on 15.10.2026:
 *  - civitai.com/api/v1/model-versions/2449544 (a Z-Image LoRA, baseModel
 *    "ZImageTurbo", one primary SafeTensor file with hashes.SHA256 in capitals)
 *  - civitai.com/api/v1/models/<id> (newest version first in modelVersions)
 *  - huggingface.co/api/models/ostris/ikea-instructions-lora-sdxl (tags with
 *    "lora" and "base_model:adapter:...", cardData.base_model)
 *  - huggingface.co/api/models/<repo>/tree/main (paths from the repo root,
 *    lfs.oid is the sha256 of the content)
 * Names and numbers are made up where the real ones do not matter.
 */

export const SHA = 'BDFF5F135B08985392810539364D53331940EF3FB2CF78595D48428C7D8EE1C0'

const file = (over: Record<string, unknown> = {}) => ({
  id: 2340724,
  sizeKB: 166140.8515625,
  name: 'Z-xhs888.safetensors',
  type: 'Model',
  metadata: { format: 'SafeTensor', size: null, fp: null },
  hashes: { AutoV2: 'BDFF5F135B', SHA256: SHA, CRC32: '658C8518' },
  downloadUrl: 'https://civitai.com/api/download/models/2449544',
  primary: true,
  ...over,
})

export const CIVITAI_VERSION_ZIMAGE = {
  id: 2449544,
  modelId: 2175220,
  name: 'v1.0',
  baseModel: 'ZImageTurbo',
  baseModelType: 'Standard',
  model: { name: 'Z-Image Street Photo', type: 'LORA', nsfw: false, poi: false },
  files: [file()],
  downloadUrl: 'https://civitai.com/api/download/models/2449544',
}

export const civitaiModel = (type: string, versions: Record<string, unknown>[]) => ({
  id: 2175220,
  name: 'Street Photo',
  type,
  modelVersions: versions,
})

export const VERSION_NEW = {
  id: 900002,
  name: 'v2.0',
  baseModel: 'Illustrious',
  files: [
    file({ name: 'training-data.zip', type: 'Training Data', primary: false, downloadUrl: 'https://civitai.com/api/download/models/900002?type=Training%20Data' }),
    file({ name: 'street-v2.safetensors', sizeKB: 223_000, downloadUrl: 'https://civitai.com/api/download/models/900002', hashes: { SHA256: 'a'.repeat(64) } }),
  ],
  downloadUrl: 'https://civitai.com/api/download/models/900002',
}

export const VERSION_OLD = {
  id: 900001,
  name: 'v1.0',
  baseModel: 'SDXL 1.0',
  files: [file({ name: 'street-v1.safetensors', downloadUrl: 'https://civitai.com/api/download/models/900001', hashes: { SHA256: 'b'.repeat(64) } })],
  downloadUrl: 'https://civitai.com/api/download/models/900001',
}

export const VERSION_PICKLE = {
  id: 900003,
  name: 'old',
  baseModel: 'SD 1.5',
  files: [file({ name: 'street.pt', metadata: { format: 'PickleTensor' } })],
}

export const VERSION_UNKNOWN_BASE = { ...VERSION_OLD, id: 900004, baseModel: 'Krea 2' }

export const HF_INFO_SDXL_LORA = {
  id: 'ostris/ikea-instructions-lora-sdxl',
  tags: ['diffusers', 'text-to-image', 'lora', 'base_model:stabilityai/stable-diffusion-xl-base-1.0', 'base_model:adapter:stabilityai/stable-diffusion-xl-base-1.0'],
  cardData: { base_model: 'stabilityai/stable-diffusion-xl-base-1.0' },
}

export const HF_INFO_PLAIN = { id: 'someone/stuff', tags: ['diffusers'], cardData: {} }

export const HF_TREE_ROOT = [
  { type: 'file', oid: 'a6344aac8c09253b3b630fb776ae94478aa0275b', size: 1519, path: '.gitattributes' },
  {
    type: 'file',
    oid: '1f2c3d4e5f60718293a4b5c6d7e8f90123456789',
    size: 228_456_164,
    path: 'ikea_instructions_xl_v1_5.safetensors',
    lfs: { oid: 'c'.repeat(64), size: 228_456_164, pointerSize: 135 },
  },
]

export const HF_TREE_SUB = [
  { type: 'file', size: 9_000_000, path: 'loras/style.safetensors', lfs: { oid: 'd'.repeat(64), size: 9_000_000 } },
]
