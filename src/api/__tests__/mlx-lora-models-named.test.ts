/**
 * The Mac's LoRA rail and LoRA stack, read with the eyes of the persona walk
 * (09.10.2026).
 *
 * What stumbled: every hint sent the customer to "one of the quantized MLX
 * image models", which is a name no screen shows; the rail said LoRAs are for
 * "an image or video model" although the Mac's video engine takes none; the
 * search field over the LoRA folder said "Search models"; and Delete said
 * "removes the file from your disk" one rail away from a gallery whose Delete
 * goes to the Trash.
 *
 * Run: npx vitest run src/api/__tests__/mlx-lora-models-named.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MAC_LORA_MODELS, MAC_LORA_MODEL_FAMILIES, mlxLoraRefusal } from '../mlx-loras'

const root = resolve(__dirname, '../../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf-8')

/** The packs of image_mflux.rs that enhance instead of making a picture
 *  (`family: Family::SeedVR2`). They take no LoRA. */
function upscalerPacks(): Set<string> {
  const source = read('src-tauri/src/commands/image_mflux.rs')
  const out = new Set<string>()
  for (const block of source.split('pub(super) const ').slice(1)) {
    const name = block.match(/^([A-Z0-9_]+): Pack = Pack \{/)?.[1]
    if (name && /family: Family::SeedVR2,/.test(block.slice(0, block.indexOf('};')))) out.add(name)
  }
  return out
}

/** Name and engine of every image catalogue entry, as Rust writes them.
 *  `secondEngine` is a picture model of the second engine: the upscaler
 *  runs there too, but makes no picture and takes no LoRA. */
function catalogue(): { name: string; secondEngine: boolean; upscaler: boolean }[] {
  const source = read('src-tauri/src/commands/mlx.rs')
  const upscalers = upscalerPacks()
  const out: { name: string; secondEngine: boolean; upscaler: boolean }[] = []
  let name: string | null = null
  for (const line of source.split('\n')) {
    const n = line.match(/^ {8}name: "([^"]+)",$/)
    if (n) name = n[1]
    const m = line.match(/^ {8}mflux: (None|Some\(&mflux::([A-Z0-9_]+)\))/)
    if (m && name) {
      const upscaler = !!m[2] && upscalers.has(m[2])
      out.push({ name, secondEngine: m[1] !== 'None' && !upscaler, upscaler })
      name = null
    }
  }
  return out
}

describe('the models that take a LoRA', () => {
  const entries = catalogue()

  it('the catalogue is read: both engines are there', () => {
    expect(entries.length).toBeGreaterThan(20)
    expect(entries.filter((e) => e.secondEngine).length).toBeGreaterThanOrEqual(7)
    expect(entries.find((e) => e.name === 'SD Turbo')?.secondEngine).toBe(false)
    // The upscaler is read as one, and is no LoRA model.
    expect(entries.filter((e) => e.upscaler).map((e) => e.name)).toEqual(['SeedVR2 3B'])
  })

  it('are exactly the ones whose name ends in 4-bit or 8-bit', () => {
    for (const e of entries) expect(/ (4|8)-bit$/.test(e.name), e.name).toBe(e.secondEngine)
  })

  it('and each belongs to a family the hint names', () => {
    for (const e of entries.filter((x) => x.secondEngine)) {
      expect(MAC_LORA_MODEL_FAMILIES.some((f) => e.name.startsWith(f)), e.name).toBe(true)
    }
    for (const f of MAC_LORA_MODEL_FAMILIES) {
      expect(entries.some((e) => e.secondEngine && e.name.startsWith(f)), f).toBe(true)
    }
  })

  it('the hint says it in the words a customer reads', () => {
    expect(MAC_LORA_MODELS).toBe('an image model whose name ends in 4-bit or 8-bit (Qwen-Image 2.1, Qwen-Image 2512, Z-Image Turbo, FLUX.2 klein 4B)')
  })

  it('no surface says "quantized MLX image models" any more', () => {
    for (const file of ['src/components/models/MacLoraLane.tsx', 'src/components/settings/MlxMediaSettings.tsx', 'src/components/create/experimental/ParamGroups.tsx']) {
      expect(read(file), file).not.toContain('quantized MLX image models')
    }
    expect(read('src/components/models/MacLoraLane.tsx')).toContain('Use them in Create with ${MAC_LORA_MODELS}: Advanced settings, Expert, LoRA stack. The other image models take no LoRA.')
    expect(read('src/components/settings/MlxMediaSettings.tsx')).toContain('The LoRA stack in Create lists them for ${MAC_LORA_MODELS}.')
  })
})

describe('what the stack says before the click is what the run says after it', () => {
  it('follows lora_files in image_mflux.rs', () => {
    const rust = read('src-tauri/src/commands/image_mflux.rs')
    // The three refusals the run knows from the header of a file.
    expect(rust).toContain('if header.keys == Keys::Unreadable {')
    expect(rust).toContain('if pack.family == Family::Qwen21 && header.keys != Keys::Peft {')
    // Unreadable: every family.
    expect(mlxLoraRefusal('unreadable', true)?.label).toBe('not readable')
    expect(mlxLoraRefusal('unreadable', false)?.label).toBe('not readable')
    // Qwen-Image 2.1 reads lora_A / lora_B alone.
    expect(mlxLoraRefusal('peft', true)).toBeNull()
    expect(mlxLoraRefusal('kohya', true)?.label).toBe('Kohya format')
    expect(mlxLoraRefusal('other', true)?.label).toBe('not a plain LoRA')
    // The other families judge a file themselves.
    expect(mlxLoraRefusal('peft', false)).toBeNull()
    expect(mlxLoraRefusal('kohya', false)).toBeNull()
    expect(mlxLoraRefusal('other', false)).toBeNull()
    // A file the listing has not classified is never held back.
    expect(mlxLoraRefusal(undefined, true)).toBeNull()
  })

  it('follows lora_stack in video.rs: LTX reads lora_A / lora_B, Wan both namings', () => {
    const rust = read('src-tauri/src/commands/video.rs')
    expect(rust).toContain('if ltx && !ltx_reads_lora(&tensor_names(&file).unwrap_or_default()) {')
    expect(rust).toContain('if !ltx && header.keys == Keys::Other {')
    expect(mlxLoraRefusal('peft', false, 'ltx')).toBeNull()
    expect(mlxLoraRefusal('kohya', false, 'ltx')?.label).toBe('Kohya format')
    expect(mlxLoraRefusal('other', false, 'ltx')?.label).toBe('not a plain LoRA')
    expect(mlxLoraRefusal('peft', false, 'wan')).toBeNull()
    expect(mlxLoraRefusal('kohya', false, 'wan')).toBeNull()
    expect(mlxLoraRefusal('other', false, 'wan')?.label).toBe('not a plain LoRA')
    expect(mlxLoraRefusal('unreadable', false, 'wan')?.label).toBe('not readable')
  })

  it('the Qwen-Image 2.1 family is the one Create opens as "qwenimage" on the Mac', () => {
    expect(read('src/api/mlx-image.ts')).toContain("if (m.id.startsWith('qwen-image-2.1')) return 'qwenimage'")
    expect(read('src-tauri/src/commands/image_mflux.rs')).toContain('Family::Qwen21 => "qwen-image-2.1",')
    // Since 14.10.2026 the video lane passes which video engine reads the file,
    // and a video lane is never Qwen-Image 2.1.
    expect(read('src/components/create/experimental/ParamGroups.tsx')).toContain("mlxLoraRefusal(loraKeys?.[name], !isVideo && laneType === 'qwenimage', macVideoEngine)")
  })
})

describe('the LoRA rail of the Mac', () => {
  const skin = read('src/components/models/skin/mac.tsx')
  const lane = read('src/components/models/MacLoraLane.tsx')

  it('promises LoRAs for image models only', () => {
    expect(skin).toContain("text: () => 'Small add-ons that give an image model a style or a subject.'")
    expect(skin).not.toContain('image or video model')
  })

  it('its search field searches LoRAs', () => {
    expect(skin).toContain("placeholder={rail === 'lora' ? 'Search LoRAs…' : 'Search models…'}")
    expect(skin).toContain("aria-label={rail === 'lora' ? 'Search LoRAs' : 'Search models'}")
  })

  it('Delete says the file moves to the Trash', () => {
    expect(lane.replace(/\s+/g, ' ')).toContain('The file moves to the Trash.')
    expect(lane).not.toContain('for good')
    // Which is true: the command hands the file to the Trash and removes none.
    const command = read('src-tauri/src/commands/mlx_loras.rs')
    expect(command).toContain('delete(&root, name, crate::commands::mlx_outputs::system_trash)')
    expect(command.split('#[cfg(test)]')[0]).not.toContain('remove_file')
  })

  it('COUNTER-CHECK: the classic face of Windows and Linux keeps its field and its sentence', () => {
    const classic = read('src/components/models/skin/classic.tsx')
    expect(classic).toContain('placeholder="Search models…"')
    expect(classic).not.toContain('Search LoRAs')
  })
})
