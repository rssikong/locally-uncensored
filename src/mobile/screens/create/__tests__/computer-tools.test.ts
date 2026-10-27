/**
 * A17: the tool row of "My computer" from what the computer names
 * (CREATE-V2.md): feature words decide which tools are there, `available`
 * and `reason` whether they can run, and a 3.0.7 computer keeps its two.
 */
import { describe, expect, it } from 'vitest'
import { readCapabilities } from '../../../remote/desktopCreate'
import { COMPUTER_TOOLS, TOOL_REASON, computerToolInForce, computerTools, kindOfTool, toolInputs, toolPrompt } from '../parts/computer-tools'

const V307 = ['sealed', 'pending', 'signin', 'create-image', 'create-video']
const V308 = [...V307, 'create-edit', 'create-upscale', 'create-removebg', 'create-music', 'create-character', 'create-gallery']

const model = [{ id: 'm', name: 'M' }]
const caps307 = readCapabilities({
  kinds: [
    { kind: 'image', available: true, models: model },
    { kind: 'image-to-image', available: true, models: model },
    { kind: 'video', available: true, models: model },
    { kind: 'image-to-video', available: true, models: model },
  ],
})
const caps308 = readCapabilities({
  kinds: [
    ...caps307.kinds.map((k) => ({ kind: k.kind, available: true, models: model })),
    { kind: 'edit', available: true, models: model },
    { kind: 'upscale', available: true, models: [] },
    { kind: 'removebg', available: true },
    { kind: 'music', available: false, reason: 'No music model is installed on your computer. Install one in Create on your computer.', models: [] },
  ],
  characters: [{ id: 'chr_mia', name: 'Mia' }],
  limits: { max_edit_inputs: 5 },
})

describe('the tool row on the computer', () => {
  it('follows the order of the cloud row', () => {
    expect(COMPUTER_TOOLS).toEqual(['image', 'edit', 'removebg', 'upscale', 'video', 'character', 'music'])
  })

  it('a 3.0.7 computer: Image and Video, as before', () => {
    expect(computerTools(V307, caps307).map((t) => t.id)).toEqual(['image', 'video'])
    expect(kindOfTool('image', true, caps307)).toBe('image-to-image')
    expect(kindOfTool('video', true, caps307)).toBe('image-to-video')
    expect(kindOfTool('video', false, caps307)).toBe('video')
    expect(toolInputs('image', caps307)).toEqual({ min: 0, max: 1 })
  })

  it('a 3.0.8 computer: every tool it names; one that cannot run stays with its reason', () => {
    const row = computerTools(V308, caps308)
    expect(row.map((t) => t.id)).toEqual(['image', 'edit', 'removebg', 'upscale', 'video', 'character', 'music'])
    expect(row.find((t) => t.id === 'music')).toEqual({ id: 'music', available: false, reason: 'No music model is installed on your computer. Install one in Create on your computer.' })
    expect(row.filter((t) => t.available).length).toBe(6)
    expect(toolInputs('edit', caps308)).toEqual({ min: 1, max: 5 })
    expect(toolInputs('upscale', caps308)).toEqual({ min: 1, max: 1 })
    expect(toolInputs('music', caps308)).toEqual({ min: 0, max: 0 })
    expect(kindOfTool('character', true, caps308)).toBe('image')
    expect(toolPrompt('removebg')).toBe('no')
    expect(toolPrompt('video')).toBe('optional')
  })

  it('a character without characters says how to get one; a missing word hides the tool', () => {
    const none = { ...caps308, characters: [] }
    expect(computerTools(V308, none).find((t) => t.id === 'character')).toEqual({ id: 'character', available: false, reason: TOOL_REASON.noCharacter })
    expect(computerTools(V308.filter((f) => f !== 'create-music'), caps308).some((t) => t.id === 'music')).toBe(false)
    // Before the capabilities are in, what is named counts as there.
    expect(computerTools(V308, null).every((t) => t.available)).toBe(true)
  })

  it('the chosen tool, or the first of the row', () => {
    const row = computerTools(V307, caps307)
    expect(computerToolInForce('video', row)).toBe('video')
    expect(computerToolInForce('music', row)).toBe('image')
    expect(computerToolInForce('image', [])).toBeNull()
  })
})
