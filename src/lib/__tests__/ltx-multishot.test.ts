import { describe, it, expect } from 'vitest'
import { MAX_SHOTS, composeShots, shotCount, supportsMultishot } from '../ltx-multishot'

// Die Fassung kommt aus docs.ltx.io, Prompting Guide, "Multi-Shot Prompts":
// ein Absatz, jeder Schnitt in Worten benannt, kein Shot-Listen-Format.

describe('Multishot: welche Modelle', () => {
  it('nur LTX 2.5', () => {
    expect(supportsMultishot('ltx25')).toBe(true)
    for (const t of ['ltx', 'wan', 'wan22', 'hunyuan', 'minimaxh3', 'unknown', '', null, undefined]) {
      expect(supportsMultishot(t as string)).toBe(false)
    }
  })

  it('die Grenze ist vier Shots, wie der Leitfaden es nennt', () => {
    expect(MAX_SHOTS).toBe(4)
  })
})

describe('Multishot: der Prompt', () => {
  it('ein Shot allein bleibt wie geschrieben, auch mit leeren Feldern', () => {
    expect(composeShots('a fox in snow', [])).toBe('a fox in snow')
    expect(composeShots('a fox in snow', ['', '   '])).toBe('a fox in snow')
  })

  it('ohne Prompt gibt es keine Szene, auch wenn weitere Shots Text haben', () => {
    expect(composeShots('', ['two'])).toBe('')
    expect(composeShots('   ', ['two'])).toBe('   ')
  })

  it('zwei Shots werden ein Absatz mit einem benannten Schnitt', () => {
    expect(composeShots('A wide shot of a fox in snow', ['A close-up of the fox, snow on its nose'])).toBe(
      'A wide shot of a fox in snow. A hard cut transitions to the next shot, with the same characters. A close-up of the fox, snow on its nose.',
    )
  })

  it('jeder weitere Shot bekommt seinen eigenen Schnitt, in der Reihenfolge', () => {
    const p = composeShots('one', ['two', 'three', 'four'])
    expect(p.match(/A hard cut transitions/g)).toHaveLength(3)
    expect(p.indexOf('one')).toBeLessThan(p.indexOf('two'))
    expect(p.indexOf('two')).toBeLessThan(p.indexOf('three'))
    expect(p.indexOf('three')).toBeLessThan(p.indexOf('four'))
  })

  it('ein leerer Shot in der Mitte faellt weg, ohne einen leeren Schnitt', () => {
    const p = composeShots('one', ['', 'three'])
    expect(p.match(/A hard cut transitions/g)).toHaveLength(1)
    expect(p).toContain('three.')
  })

  it('ein Satzzeichen des Nutzers wird nicht verdoppelt', () => {
    expect(composeShots('One!', ['Two?'])).toContain('One! A hard cut')
    expect(composeShots('One.', ['Two.'])).not.toContain('..')
  })

  it('es ist ein einziger Absatz: kein Zeilenumbruch, keine Nummerierung, keine Labels', () => {
    const p = composeShots('one\nline', ['two\n\nlines', 'three'])
    expect(p).not.toMatch(/\n/)
    expect(p).not.toMatch(/\b(shot|beat|scene) ?\d/i)
    expect(p).not.toMatch(/^\s*[-*\d]/m)
  })

  it('kein Gedankenstrich im Text, der an das Modell geht', () => {
    expect(composeShots('a', ['b'])).not.toMatch(new RegExp('[\\u2014\\u2013]'))
  })

  it('zaehlt die Shots, die wirklich Text haben', () => {
    expect(shotCount('one', ['two', '', 'four'])).toBe(3)
    expect(shotCount('', ['two'])).toBe(1)
  })
})

describe('Multishot: was ein lokaler Lauf schickt', () => {
  const run = { prompt: 'one', shots: ['two'], mode: 'video', intent: 'video', onMlxHost: false, modelType: 'ltx25' }
  const composed = composeShots('one', ['two'])

  it('Text-zu-Video auf LTX 2.5 schickt die Shots', async () => {
    const { scenePromptFor } = await import('../ltx-multishot')
    expect(scenePromptFor(run)).toBe(composed)
  })

  it('jedes andere Modell, jede andere Spur und ein Mac ohne LTX-2.5-Paket schicken den Prompt wie getippt', async () => {
    const { scenePromptFor } = await import('../ltx-multishot')
    expect(scenePromptFor({ ...run, modelType: 'wan22' })).toBe('one')
    expect(scenePromptFor({ ...run, intent: 'animate' })).toBe('one')
    expect(scenePromptFor({ ...run, intent: 'image', mode: 'image' })).toBe('one')
    // A Mac takes the list where its video catalogue says so (the LTX-2.5
    // packs, M8 14.10.2026), and the model type of a ComfyUI file says
    // nothing there. Changed on purpose: the Mac used to take none.
    expect(scenePromptFor({ ...run, onMlxHost: true })).toBe('one')
    expect(scenePromptFor({ ...run, onMlxHost: true, macMultishot: false })).toBe('one')
    expect(scenePromptFor({ ...run, onMlxHost: true, macMultishot: true, modelType: 'ltx' })).toBe(composed)
    expect(scenePromptFor({ ...run, onMlxHost: true, macMultishot: true, intent: 'animate' })).toBe('one')
    expect(scenePromptFor({ ...run, shots: [] })).toBe('one')
  })
})
