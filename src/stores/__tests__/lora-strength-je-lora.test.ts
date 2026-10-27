/**
 * The stack keeps one strength per LoRA, from -20 to 20, and remembers it
 * while the LoRA is off (Discord 2026-10-02).
 *
 * Run: npx vitest run src/stores/__tests__/lora-strength-je-lora.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useCreateStore } from '../createStore'

const A = 'krea2_slider_age.safetensors'
const B = 'film_grain_xl.safetensors'
const TURBO = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'

const s = () => useCreateStore.getState()
const strengthOf = (name: string) => s().selectedLoras.find((l) => l.name === name)?.strength

beforeEach(() => {
  useCreateStore.setState({ selectedLoras: [], loraStrengths: {} })
})

describe('the range the store lets through', () => {
  it('takes negative and wide values, which the old 0 to 2 clamp cut off', () => {
    s().toggleLora(A)
    s().setLoraStrengthFor(A, -4)
    expect(strengthOf(A)).toBe(-4)
    s().setLoraStrengthFor(A, 7.5)
    expect(strengthOf(A)).toBe(7.5)
    s().setLoraStrengthFor(A, -10)
    expect(strengthOf(A)).toBe(-10)
    s().setLoraStrengthFor(A, 15)
    expect(strengthOf(A)).toBe(15)
    s().setLoraStrengthFor(A, -20)
    expect(strengthOf(A)).toBe(-20)
    s().setLoraStrengthFor(A, 20)
    expect(strengthOf(A)).toBe(20)
  })

  it('pulls anything further out to the ends and ignores what is not a number', () => {
    s().toggleLora(A)
    s().setLoraStrengthFor(A, 42)
    expect(strengthOf(A)).toBe(20)
    s().setLoraStrengthFor(A, -42)
    expect(strengthOf(A)).toBe(-20)
    s().setLoraStrengthFor(A, 1.5)
    s().setLoraStrengthFor(A, Number.NaN)
    s().setLoraStrengthFor(A, Number.POSITIVE_INFINITY)
    expect(strengthOf(A)).toBe(1.5)
  })
})

describe('one value per LoRA', () => {
  it('each LoRA has its own strength', () => {
    s().toggleLora(A)
    s().toggleLora(B)
    s().setLoraStrengthFor(A, -3)
    s().setLoraStrengthFor(B, 1.2)
    expect(s().selectedLoras).toEqual([{ name: A, strength: -3 }, { name: B, strength: 1.2 }])
  })

  it('off and on again brings the own value back, not the default', () => {
    s().toggleLora(A)
    s().setLoraStrengthFor(A, -6.5)
    s().toggleLora(A)
    expect(s().selectedLoras).toEqual([])
    s().toggleLora(A)
    expect(strengthOf(A)).toBe(-6.5)
  })

  it('Clear keeps the remembered values too', () => {
    s().toggleLora(A)
    s().setLoraStrengthFor(A, 3)
    s().clearLoras()
    s().toggleLora(A)
    expect(strengthOf(A)).toBe(3)
  })

  it('a file that is gone takes its remembered value with it', () => {
    s().toggleLora(A)
    s().setLoraStrengthFor(A, 3)
    s().toggleLora(B)
    s().setLoraStrengthFor(B, 0.5)
    s().toggleLora(A)
    s().keepListedLoras([B])
    expect(s().loraStrengths).toEqual({ [B]: 0.5 })
    expect(s().selectedLoras).toEqual([{ name: B, strength: 0.5 }])
    // Same name dropped in again later: a new file, the default.
    s().toggleLora(A)
    expect(strengthOf(A)).toBe(0.8)
  })

  it('a first tick starts at 0.8, the H3 turbo LoRA at 1', () => {
    s().toggleLora(B)
    s().toggleLora(TURBO)
    expect(strengthOf(B)).toBe(0.8)
    expect(strengthOf(TURBO)).toBe(1)
  })

  it('the remembered values are saved with the stack', () => {
    s().toggleLora(A)
    s().setLoraStrengthFor(A, -2)
    const saved = useCreateStore.persist.getOptions().partialize?.(s()) as { selectedLoras: unknown; loraStrengths: unknown }
    expect(saved.selectedLoras).toEqual([{ name: A, strength: -2 }])
    expect(saved.loraStrengths).toEqual({ [A]: -2 })
  })
})

// The box, 03.10.2026: "Reset to model defaults" left a LoRA from an earlier
// session switched on (only Clear removed it), so the run after a reset was
// not the model's own picture. Reset switches the stack off like Clear does.
// The strength each LoRA was left at stays remembered.
describe('Reset to model defaults and the LoRA stack', () => {
  it('switches the stack off and keeps the remembered strength', () => {
    useCreateStore.setState({ selectedLoras: [], loraStrengths: {}, selectedCharacter: null } as never)
    const s = useCreateStore.getState()
    s.toggleLora('char_lukompass_zimage.safetensors')
    s.setLoraStrengthFor('char_lukompass_zimage.safetensors', 1.33)
    useCreateStore.getState().resetParamsToModelDefaults()
    expect(useCreateStore.getState().selectedLoras).toEqual([])
    expect(useCreateStore.getState().loraStrengths['char_lukompass_zimage.safetensors']).toBe(1.33)
    useCreateStore.getState().toggleLora('char_lukompass_zimage.safetensors')
    expect(useCreateStore.getState().selectedLoras).toEqual([{ name: 'char_lukompass_zimage.safetensors', strength: 1.33 }])
  })

  it('takes the local character that rode on a LoRA with it, like Clear', () => {
    useCreateStore.setState({
      selectedLoras: [{ name: 'char_probe.safetensors', strength: 1 }],
      selectedCharacter: { id: 'local:char_probe.safetensors', name: 'probe' },
    } as never)
    useCreateStore.getState().resetParamsToModelDefaults()
    expect(useCreateStore.getState().selectedLoras).toEqual([])
    expect(useCreateStore.getState().selectedCharacter).toBeNull()
  })
})
