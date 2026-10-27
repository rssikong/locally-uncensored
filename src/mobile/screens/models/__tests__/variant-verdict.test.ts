/**
 * One verdict and one set of marks per model, before and after the download
 * (acceptance Android, re-run, N1).
 *
 * The detail page offers every quantization of a catalogue model. Qwen 3.5 2B
 * IQ2_M was "Tight fit" there and could be downloaded. Once on the phone the
 * same file was "Too large, may not load" in the list "Installed" and had lost
 * "Thinking" and "Tools": the list looked the file up by its exact name, did
 * not find it, and judged it as an unknown file with the careful fallbacks.
 *
 * This file walks EVERY catalogue model in EVERY packing on EVERY RAM class
 * and holds the three places against each other and against what the
 * catalogue says about the model.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BundledModel } from '../../../../api/engine'
import { MOBILE_CHAT_MODELS, catalogModelForFile, modelFileStem, quantOfFileName, type MobileModel } from '../../../data/mobile-models'
import { assessFit, fitModelOfFile, packedBelowThreeBit, type FitDevice } from '../../../lib/device-fit'
import { deviceModelCallsTools, factsOfChatModel } from '../../../lib/model-facts'
import { cardOfCatalog, cardOfFile, fitOfFile, fitOfNamedFile, fitOfVariant } from '../parts/catalog'
import { fitOfCatalogModel, fitView } from '../parts/fit'
import { bareName, chatModelId, displayName } from '../parts/installed'

/** Bits per weight of the packings a repository usually holds, the smallest to the largest. */
const PACKINGS: ReadonlyArray<{ quant: string; bits: number }> = [
  { quant: 'IQ1_S', bits: 1.6 },
  { quant: 'IQ2_XXS', bits: 2.1 },
  { quant: 'IQ2_M', bits: 2.7 },
  { quant: 'Q2_K', bits: 3.35 },
  { quant: 'IQ3_XXS', bits: 3.1 },
  { quant: 'Q3_K_M', bits: 3.9 },
  { quant: 'IQ4_XS', bits: 4.25 },
  { quant: 'Q4_0', bits: 4.55 },
  { quant: 'Q4_K_S', bits: 4.6 },
  { quant: 'Q5_K_M', bits: 5.7 },
  { quant: 'Q6_K', bits: 6.6 },
  { quant: 'Q6_K_L', bits: 6.8 },
  { quant: 'Q8_0', bits: 8.5 },
  { quant: 'BF16', bits: 16 },
  { quant: 'F16', bits: 16 },
]
/** What packers put in front of the quantization: nothing, Unsloth's dynamic mark, the imatrix marks. */
const MARKS = ['', 'UD-', 'i1-', 'imat-']

const DEVICES: FitDevice[] = [
  ...[2, 3, 4, 6, 8, 12, 16].map((ramGb): FitDevice => ({ platform: 'ios', ramGb })),
  ...[3, 4, 6, 8, 12, 16].map((ramGb): FitDevice => ({ platform: 'android', ramGb })),
]

interface Variant { model: MobileModel; quant: string; filename: string; sizeBytes: number }

/** The file of another packing, named the way the repository of the catalogue file names its files. */
function variantsOf(model: MobileModel): Variant[] {
  const out: Variant[] = []
  const at = model.filename.search(/q4_k_m/i)
  for (const { quant, bits } of PACKINGS) {
    for (const mark of MARKS) {
      const filename = `${model.filename.slice(0, at)}${mark}${quant}${model.filename.slice(at + 'Q4_K_M'.length)}`
      // Scaled from the real file: the catalogue file is 4.85 bits per weight.
      out.push({ model, quant, filename, sizeBytes: Math.round((model.sizeBytes * bits) / 4.85) })
    }
  }
  return out
}

const ALL: Variant[] = MOBILE_CHAT_MODELS.flatMap(variantsOf)

function onPhone(variant: Variant, ctxTrain: number | null): BundledModel {
  const name = bareName(variant.filename)
  return { name, path: `/models/${variant.filename}`, size: variant.sizeBytes, ctx_train: ctxTrain } as BundledModel
}

/** What the catalogue says about the model, with the size of this file: the verdict the detail page gave before round 5. */
function catalogueVerdict(variant: Variant, device: FitDevice) {
  const { model } = variant
  return fitView({ fileBytes: variant.sizeBytes, quant: variant.quant, paramsB: model.paramsB, kvBytesPerToken: model.kvBytesPerToken, maxContext: model.trainedContext }, device)
}

describe('a file name leads to its catalogue model', () => {
  it('no two catalogue models share a name stem', () => {
    const stems = MOBILE_CHAT_MODELS.map((m) => modelFileStem(m.filename))
    expect(new Set(stems).size).toBe(stems.length)
    for (const stem of stems) expect(stem.length).toBeGreaterThan(3)
  })

  it('the listed file is an exact hit, with and without the ending', () => {
    for (const model of MOBILE_CHAT_MODELS) {
      expect(catalogModelForFile(model.filename)).toMatchObject({ model, exact: true })
      expect(catalogModelForFile(bareName(model.filename))).toMatchObject({ model, exact: true })
    }
  })

  it('every packing of every catalogue model is found, with its own quantization', () => {
    expect(ALL.length).toBe(MOBILE_CHAT_MODELS.length * PACKINGS.length * MARKS.length)
    for (const variant of ALL) {
      const hit = catalogModelForFile(variant.filename)
      expect(hit?.model.id, variant.filename).toBe(variant.model.id)
      expect(hit?.exact, variant.filename).toBe(false)
      expect(hit?.quant, variant.filename).toBe(variant.quant)
      expect(quantOfFileName(variant.filename)).toBe(variant.quant)
    }
  })

  it('a file of another model is not taken for a catalogue model', () => {
    for (const name of ['Mistral-7B-Instruct-v0.3-Q4_K_M.gguf', 'Qwen3.5-2B-Coder-Q4_K_M.gguf', 'my-own-finetune.gguf', 'Qwen3.5-2B-abliterated-Q4_K_M.gguf', '']) {
      expect(catalogModelForFile(name), name).toBeUndefined()
    }
  })
})

describe('one verdict per file: offered, installed, in the model sheet', () => {
  it('every packing of every catalogue model gets the same verdict in all three places, on every RAM class', () => {
    let compared = 0
    for (const variant of ALL) {
      for (const device of DEVICES) {
        const truth = catalogueVerdict(variant, device)
        const offered = fitOfNamedFile(variant.filename, variant.sizeBytes, device)
        const hitCard = fitOfVariant({ quant: variant.quant, files: [{ filename: variant.filename, url: '', sizeBytes: variant.sizeBytes }], totalBytes: variant.sizeBytes, sharded: false }, device)
        const sheet = assessFit({ device, model: fitModelOfFile(chatModelId(bareName(variant.filename)).split('::')[1], variant.sizeBytes) }).verdict
        const where = `${variant.filename} on ${device.platform} ${device.ramGb} GB`
        expect(offered.level, where).toBe(truth.level)
        expect(offered.needBytes, where).toBe(truth.needBytes)
        expect(offered.long, where).toBe(truth.long)
        expect(hitCard.level, where).toBe(truth.level)
        // The file says its trained context once it is on the phone, or says nothing: the verdict is the same.
        for (const ctxTrain of [variant.model.trainedContext, null]) {
          const installed = fitOfFile(onPhone(variant, ctxTrain), device)
          expect(installed.level, where).toBe(offered.level)
          expect(installed.needBytes, where).toBe(offered.needBytes)
          expect(installed.short, where).toBe(offered.short)
          expect(installed.long, where).toBe(offered.long)
          expect(installed.maxContext, where).toBe(offered.maxContext)
        }
        if (truth.level !== 'unknown') expect(sheet, where).toBe(truth.level)
        compared += 1
      }
    }
    expect(compared).toBe(ALL.length * DEVICES.length)
    // Every packing times every RAM class, three renderings each: 3 to 4 s on a free machine,
    // which the default limit of 5 s does not survive under load. The time is not what is tested.
  }, 20_000)

  it('the listed file of every catalogue model is judged as its catalogue card', () => {
    for (const model of MOBILE_CHAT_MODELS) {
      for (const device of DEVICES) {
        const file = { name: bareName(model.filename), path: `/models/${model.filename}`, size: model.sizeBytes, ctx_train: model.trainedContext } as BundledModel
        const card = fitOfCatalogModel(model, device)
        expect(fitOfFile(file, device)).toEqual(card)
        expect(fitOfNamedFile(model.filename, model.sizeBytes, device)).toEqual(card)
      }
    }
  })

  it('the case of the acceptance run: Qwen 3.5 2B IQ2_M on a 4 GB Android phone is tight before and after', () => {
    const device: FitDevice = { platform: 'android', ramGb: 4 }
    const file = { name: 'Qwen3.5-2B-UD-IQ2_M', path: '/models/Qwen3.5-2B-UD-IQ2_M.gguf', size: 820 * 1_048_576, ctx_train: 262144 } as BundledModel
    expect(fitOfNamedFile('Qwen3.5-2B-UD-IQ2_M.gguf', file.size, device).level).toBe('tight')
    expect(fitOfFile(file, device).level).toBe('tight')
    // What the list did before: the file alone, judged with the fallbacks for an unknown model.
    expect(fitView({ fileBytes: file.size, maxContext: 262144 }, device).level).toBe('too-large')
  })

  it('the figures of the acceptance run: about 1.3 GB and the full context, not 1.6 GB and 768 tokens (N1, N11)', () => {
    const device: FitDevice = { platform: 'android', ramGb: 4 }
    const file = { name: 'Qwen3.5-2B-UD-IQ2_M', path: '/models/Qwen3.5-2B-UD-IQ2_M.gguf', size: 820 * 1_048_576, ctx_train: 262144 } as BundledModel
    const installed = fitOfFile(file, device)
    expect(Math.round(installed.needBytes / 1_048_576)).toBe(1358)
    // The engine loads this model with 4096 tokens. The detail page said "Up to 768 on this phone".
    expect(installed.maxContext).toBe(4096)
    const before = fitView({ fileBytes: file.size, maxContext: 262144 }, device)
    expect(Math.round(before.needBytes / 1_048_576)).toBe(1590)
    expect(before.maxContext).toBe(768)
  })

  it('the case of the large iPhone: Qwen 3.5 2B in its smallest packing keeps name, need and marks (G3)', () => {
    // The file as the repository names it, with Unsloth's mark in front of the packing, 732.7 MB.
    const filename = 'Qwen3.5-2B-UD-IQ2_XXS.gguf'
    const size = Math.round(732.7 * 1_048_576)
    const listed = MOBILE_CHAT_MODELS.find((m) => modelFileStem(m.filename) === 'qwen3.5-2b')
    expect(listed).toBeDefined()
    expect(modelFileStem(filename)).toBe('qwen3.5-2b')
    expect(quantOfFileName(filename)).toBe('IQ2_XXS')
    expect(catalogModelForFile(filename)).toMatchObject({ model: listed, exact: false, quant: 'IQ2_XXS' })
    expect(catalogModelForFile('Qwen3.5-2B-UD-IQ2_XXS')).toMatchObject({ model: listed, exact: false, quant: 'IQ2_XXS' })

    const file = { name: 'Qwen3.5-2B-UD-IQ2_XXS', path: `/models/${filename}`, size, ctx_train: 262144 } as BundledModel
    for (const device of DEVICES) {
      // "about 1.2 GB" before and "About 1.7 GB" after was one file judged twice. Now it is judged once.
      expect(fitOfFile(file, device)).toEqual(fitOfNamedFile(filename, size, device))
    }
    const card = cardOfFile(file)
    const catalogue = cardOfCatalog(listed!)
    expect(card.name).toBe('Qwen 3.5 2B IQ2_XXS')
    expect(card.thinking).toBe(catalogue.thinking)
    expect(card.thinking).toBe(true)
    // The model drives tools, a 2 bit packing of it does not carry the mark (check on Android with 4 GB, F3).
    expect(catalogue.tools).toBe(true)
    expect(card.tools).toBe(false)
    expect(factsOfChatModel(chatModelId('Qwen3.5-2B-UD-IQ2_XXS'))?.model).toBe(listed)
    expect(deviceModelCallsTools(chatModelId('Qwen3.5-2B-UD-IQ2_XXS'))).toBe(false)
  })

  it('a file the catalogue does not know gets the same verdict before and after as well', () => {
    for (const device of DEVICES) {
      for (const [filename, size] of [['Mistral-7B-Instruct-v0.3-Q4_K_M.gguf', 4_372_812_000], ['TinyStories-33M-Q8_0.gguf', 40_000_000], ['granite-4.0-micro-Q4_K_M.gguf', 2_100_000_000]] as const) {
        const offered = fitOfNamedFile(filename, size, device)
        const installed = fitOfFile({ name: bareName(filename), path: `/models/${filename}`, size, ctx_train: null } as BundledModel, device)
        expect(installed).toEqual(offered)
      }
    }
  })
})

describe('what a model can do stays with every packing of it', () => {
  it('the card of an installed packing carries the marks of the catalogue card', () => {
    for (const variant of ALL) {
      const listed = cardOfCatalog(variant.model)
      const card = cardOfFile(onPhone(variant, null))
      // Tools: the model's mark from 3 bit on, none below (check on Android with 4 GB, F3).
      expect(card.tools, variant.filename).toBe(listed.tools === true && !packedBelowThreeBit(variant.quant))
      expect(card.thinking, variant.filename).toBe(listed.thinking)
      expect(card.uncensored, variant.filename).toBe(listed.uncensored)
      expect(card.vision, variant.filename).toBe(listed.vision)
      expect(card.weak, variant.filename).toBe(listed.weak)
      // It is still its own file: its own page, its own name, its own packing.
      expect(card.routeId).toBe(`file:${bareName(variant.filename)}`)
      expect(card.filename).toBe(variant.filename)
      expect(card.quant).toBe(variant.quant)
      expect(card.name).toBe(`${variant.model.name} ${variant.quant}`)
      expect(card.name).toBe(displayName({ name: bareName(variant.filename) }))
    }
  })

  it('the chat is told the same: thinking by the model, tools by the model and the packing', () => {
    for (const model of MOBILE_CHAT_MODELS) {
      const names = [model.filename, ...variantsOf(model).map((v) => v.filename)].map((f) => chatModelId(bareName(f)))
      for (const name of names) {
        expect(factsOfChatModel(name)?.thinking, name).toBe(model.thinking)
        // Tools are a fact of the file: the model drives them and the packing has 3 bits or more.
        expect(deviceModelCallsTools(name), name).toBe(model.agent === true && !packedBelowThreeBit(quantOfFileName(name)))
      }
    }
  })

  it('declares nothing for a file the catalogue does not know and for a model that is not on the phone', () => {
    expect(deviceModelCallsTools('openai::Mistral-7B-Instruct-v0.3-Q4_K_M')).toBeUndefined()
    expect(deviceModelCallsTools('lu-cloud::qwen3.5-2b')).toBeUndefined()
    expect(deviceModelCallsTools(null)).toBeUndefined()
  })

  it('the smallest catalogue model declares that it does not call tools', () => {
    expect(deviceModelCallsTools('openai::SmolLM2-360M-Instruct-Q4_K_M')).toBe(false)
    expect(deviceModelCallsTools('openai::Qwen3.5-2B-UD-IQ2_M')).toBe(false)
    expect(deviceModelCallsTools('openai::Qwen3.5-2B-Q4_K_M')).toBe(true)
  })
})

describe('the screens ask the one function', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')

  it('the detail page judges a variant by name and size, not with figures of its own', () => {
    const page = read('ModelDetailPage.tsx')
    expect(page).toContain('fitOfNamedFile(filename,')
    expect(page).toContain('fitOfFile(fileOnPhone, device)')
    expect(page).not.toMatch(/kvBytesPerToken:\s*known/)
    expect(page).not.toContain('paramsFromName')
  })

  it('the model sheet of the chat and the check before a load pass the file name', () => {
    expect(readFileSync(join(__dirname, '..', '..', 'chat', 'ModelSheet.tsx'), 'utf8')).toContain('fitModelOfFile(displayModelName(name), size)')
    expect(readFileSync(join(__dirname, '..', '..', 'chat', 'parts', 'preload.ts'), 'utf8')).toContain('fitModelOfFile(filename, fileBytes)')
    expect(readFileSync(join(__dirname, '..', '..', '..', 'boot', 'wiring.ts'), 'utf8')).not.toContain('model: { fileBytes: model.fileBytes }')
  })
})
