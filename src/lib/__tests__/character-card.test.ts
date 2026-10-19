/**
 * Character cards (3.0.7, Discord D1): reading v1/v2/v3 JSON and PNG cards,
 * the role play system prompt with its macros, the greetings, and the export
 * round trip.
 *
 * Run: npx vitest run src/lib/__tests__/character-card.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  CardError, DEFAULT_RP_SYSTEM_PROMPT, MAX_CARD_JSON_BYTES, buildCardSystemPrompt, cardChatStart, cardFileName,
  normalizeCard, parseCardFile, parseCardJson, parseCardPng, personaFromCard, personaToCardJson, substituteMacros,
} from '../character-card'
import { V1_CARD, V2_CARD, V3_CARD, PYGMALION_CARD, b64, chunk, iTXt, png, tEXt } from './character-card-fixtures'

const enc = (s: string) => new TextEncoder().encode(s)

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function rejects(p: Promise<unknown>, text: RegExp) {
  await expect(p).rejects.toBeInstanceOf(CardError)
  await expect(p).rejects.toThrow(text)
}

describe('JSON cards', () => {
  it('reads every field of a chara_card_v2', () => {
    const { name, card } = parseCardJson(JSON.stringify(V2_CARD))
    expect(name).toBe('Mira')
    expect(card.description).toBe(V2_CARD.data.description)
    expect(card.personality).toBe('dry humour, patient, curious')
    expect(card.scenario).toBe(V2_CARD.data.scenario)
    expect(card.firstMessage).toBe(V2_CARD.data.first_mes)
    expect(card.exampleMessages).toBe(V2_CARD.data.mes_example)
    expect(card.alternateGreetings).toEqual(V2_CARD.data.alternate_greetings)
    expect(card.systemPrompt).toBe('')
    expect(card.postHistoryInstructions).toBe('Stay in character as {{char}}.')
    expect(card.creatorNotes).toBe('Works best with slow paced scenes.')
    expect(card.tags).toEqual(['fantasy', 'calm'])
    expect(card.extensions).toEqual({ talkativeness: '0.5' })
  })

  it('reads a chara_card_v3', () => {
    expect(parseCardJson(JSON.stringify(V3_CARD)).name).toBe('Mira v3')
  })

  it('reads a v1 card with bare fields and the older Pygmalion spellings', () => {
    const v1 = parseCardJson(JSON.stringify(V1_CARD))
    expect(v1.name).toBe('Old Tom')
    expect(v1.card.firstMessage).toBe('What do you want, <USER>?')
    expect(v1.card.alternateGreetings).toEqual([])
    const pyg = parseCardJson(JSON.stringify(PYGMALION_CARD))
    expect(pyg.name).toBe('Pyg')
    expect(pyg.card.description).toBe('An old format character.')
    expect(pyg.card.scenario).toBe('Somewhere.')
    expect(pyg.card.firstMessage).toBe('Hello <USER>, I am <BOT>.')
  })

  it('ignores wrong field types instead of crashing', () => {
    const { card } = parseCardJson(JSON.stringify({
      spec: 'chara_card_v2', data: { name: 'X', description: 42, alternate_greetings: ['ok', 7, null, ''], tags: 'nope' },
    }))
    expect(card.description).toBe('')
    expect(card.alternateGreetings).toEqual(['ok'])
    expect(card.tags).toBeUndefined()
  })

  it.each([
    ['not JSON', '{nope', /not valid JSON/],
    ['an array', '[]', /not a character card/],
    ['no name', JSON.stringify({ spec: 'chara_card_v2', data: { description: 'x' } }), /no name/],
    ['no data', JSON.stringify({ spec: 'chara_card_v2' }), /no data section/],
    ['unknown spec', JSON.stringify({ spec: 'something_else', data: { name: 'x' } }), /Unknown character card format/],
  ])('refuses %s with a clear sentence', (_label, text, msg) => {
    expect(() => parseCardJson(text)).toThrow(CardError)
    expect(() => parseCardJson(text)).toThrow(msg)
  })

  it('refuses JSON above the size cap', () => {
    const big = JSON.stringify({ name: 'x', description: 'a'.repeat(MAX_CARD_JSON_BYTES) })
    expect(() => parseCardJson(big)).toThrow(/too large/)
  })
})

describe('PNG cards', () => {
  it('reads the card from a tEXt chunk named chara', async () => {
    const { name } = await parseCardPng(png(tEXt('chara', b64(V2_CARD))))
    expect(name).toBe('Mira')
  })

  it('reads the card from an iTXt chunk, plain and compressed', async () => {
    expect((await parseCardPng(png(iTXt('chara', enc(b64(V2_CARD)))))).name).toBe('Mira')
    const packed = await deflate(enc(b64(V2_CARD)))
    expect((await parseCardPng(png(iTXt('chara', packed, true)))).name).toBe('Mira')
  })

  it('prefers ccv3 over chara, and falls back to chara when ccv3 is broken', async () => {
    const both = png(tEXt('chara', b64(V2_CARD)), tEXt('ccv3', b64(V3_CARD)))
    expect((await parseCardPng(both)).name).toBe('Mira v3')
    const brokenV3 = png(tEXt('ccv3', b64({ spec: 'chara_card_v3' })), tEXt('chara', b64(V2_CARD)))
    expect((await parseCardPng(brokenV3)).name).toBe('Mira')
  })

  it('keeps UTF-8 names intact', async () => {
    const card = { ...V2_CARD, data: { ...V2_CARD.data, name: 'Zoë 雪' } }
    expect((await parseCardPng(png(tEXt('chara', b64(card))))).name).toBe('Zoë 雪')
  })

  it('refuses a PNG without a card', async () => {
    await rejects(parseCardPng(png(tEXt('Comment', 'hello'))), /no character card/)
  })

  it('refuses a truncated chunk', async () => {
    const full = png(tEXt('chara', b64(V2_CARD)))
    await rejects(parseCardPng(full.slice(0, 60)), /damaged/)
  })

  it('refuses a chunk length that points past the end', async () => {
    const bad = png(chunk('tEXt', [1, 2, 3]))
    // Overwrite the tEXt length with a huge number.
    const at = 8 + 25
    bad.set([0x7f, 0xff, 0xff, 0xff], at)
    await rejects(parseCardPng(bad), /damaged/)
  })

  it('refuses damaged base64 and damaged JSON inside the image', async () => {
    await rejects(parseCardPng(png(tEXt('chara', '!!!not base64!!!'))), /damaged/)
    await rejects(parseCardPng(png(tEXt('chara', btoa('{broken')))), /not valid JSON/)
  })
})

describe('parseCardFile picks the reader by content', () => {
  it('reads PNG and JSON bytes', async () => {
    expect((await parseCardFile(png(tEXt('chara', b64(V2_CARD))))).name).toBe('Mira')
    expect((await parseCardFile(enc(JSON.stringify(V1_CARD)))).name).toBe('Old Tom')
  })

  it('refuses empty files, random bytes and oversized files', async () => {
    await rejects(parseCardFile(new Uint8Array()), /empty/)
    await rejects(parseCardFile(new Uint8Array([0, 1, 2, 3, 255])), /not valid JSON/)
    await rejects(parseCardFile(new Uint8Array(21 * 1024 * 1024)), /20 MB/)
  })
})

describe('system prompt and greetings', () => {
  const { name, card } = parseCardJson(JSON.stringify(V2_CARD))

  it('orders the parts like SillyTavern and keeps the macros until a chat starts', () => {
    const prompt = buildCardSystemPrompt(card)
    const order = [
      DEFAULT_RP_SYSTEM_PROMPT,
      card.description,
      "{{char}}'s personality: dry humour, patient, curious",
      'Scenario: {{user}} washes up',
      'Example dialogue between {{char}} and {{user}}',
      '{{user}}: Where am I?',
      '{{user}}: Who are you?',
      'Stay in character as {{char}}.',
    ].map((part) => prompt.indexOf(part))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(prompt).not.toMatch(/<START>/i)
  })

  it('uses the card system prompt instead of the standard sentence, with {{original}}', () => {
    expect(buildCardSystemPrompt({ ...card, systemPrompt: 'Be {{char}}.' })).toMatch(/^Be \{\{char\}\}\./)
    expect(buildCardSystemPrompt({ ...card, systemPrompt: '{{original}} Extra.' }))
      .toMatch(new RegExp(`^${DEFAULT_RP_SYSTEM_PROMPT.replace(/[.'{}]/g, '\\$&')} Extra\\.`))
  })

  it('fills in {{char}}, {{user}} and the v1 spellings', () => {
    expect(substituteMacros('{{char}} meets {{User}}, <BOT> greets <user>', 'Mira', 'Ana'))
      .toBe('Mira meets Ana, Mira greets Ana')
    // A name with $ must not be read as a replacement pattern.
    expect(substituteMacros('{{user}}', 'x', '$& $1')).toBe('$& $1')
  })

  it('starts a chat with the filled prompt and every greeting', () => {
    const persona = personaFromCard({ name, card }, 'p1')
    const start = cardChatStart(persona, 'Ana')!
    expect(start.systemPrompt).toContain('fictional chat between Mira and Ana')
    expect(start.systemPrompt).not.toMatch(/\{\{(char|user)\}\}/)
    expect(start.greetings).toEqual([
      '*Mira lowers the lantern.* You are awake, Ana.',
      'The kettle whistles. Mira glances at Ana.',
      'A gull screams outside.',
    ])
    expect(cardChatStart(persona)!.greetings[0]).toContain('awake, User.')
  })

  it('gives nothing for a persona without a card, or with a broken stored card', () => {
    expect(cardChatStart({ name: 'a', systemPrompt: 'b' })).toBeNull()
    expect(cardChatStart({ name: 'a', systemPrompt: 'b', card: 'junk' as never })).toBeNull()
    expect(normalizeCard({ firstMessage: 5, alternateGreetings: 'x' })).toMatchObject({ firstMessage: '', alternateGreetings: [] })
  })
})

describe('export', () => {
  it('writes chara_card_v2 that reads back to the same persona', () => {
    const parsed = parseCardJson(JSON.stringify(V2_CARD))
    const persona = personaFromCard(parsed, 'p1', 'data:image/jpeg;base64,AAAA')
    const json = personaToCardJson(persona)
    const obj = JSON.parse(json)
    expect(obj.spec).toBe('chara_card_v2')
    expect(obj.spec_version).toBe('2.0')
    expect(obj.data).toEqual(V2_CARD.data)
    const again = parseCardJson(json)
    expect(again).toEqual(parsed)
    expect(personaFromCard(again, 'p1').systemPrompt).toBe(persona.systemPrompt)
  })

  it('takes a renamed persona name and refuses a plain persona', () => {
    const persona = { ...personaFromCard(parseCardJson(JSON.stringify(V1_CARD)), 'p'), name: 'Captain Tom' }
    expect(JSON.parse(personaToCardJson(persona)).data.name).toBe('Captain Tom')
    expect(() => personaToCardJson({ name: 'x', systemPrompt: 'y' })).toThrow(CardError)
  })

  it('names the file after the character', () => {
    expect(cardFileName('Mira the Keeper!')).toBe('Mira_the_Keeper.json')
    expect(cardFileName('../..')).toBe('character.json')
  })
})
