/**
 * Small hand made character cards for the tests. Built here instead of
 * checked in so no card from the internet ends up in the repo, and so a PNG
 * can carry exactly the chunks a test wants.
 */
export const V2_CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira',
    description: '{{char}} is a lighthouse keeper on a cold northern island.',
    personality: 'dry humour, patient, curious',
    scenario: '{{user}} washes up on the shore after a storm.',
    first_mes: '*{{char}} lowers the lantern.* You are awake, {{user}}.',
    mes_example: '<START>\n{{user}}: Where am I?\n{{char}}: On my rock. Tea?\n<START>\n{{user}}: Who are you?\n{{char}}: The keeper.',
    creator_notes: 'Works best with slow paced scenes.',
    system_prompt: '',
    post_history_instructions: 'Stay in character as {{char}}.',
    alternate_greetings: ['The kettle whistles. {{char}} glances at {{user}}.', 'A gull screams outside.'],
    tags: ['fantasy', 'calm'],
    creator: 'lu-tests',
    character_version: '1.0',
    extensions: { talkativeness: '0.5' },
  },
}

export const V3_CARD = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: { ...V2_CARD.data, name: 'Mira v3', group_only_greetings: [], assets: [] },
}

export const V1_CARD = {
  name: 'Old Tom',
  description: 'A retired sailor.',
  personality: 'grumpy',
  scenario: 'A harbour pub.',
  first_mes: 'What do you want, <USER>?',
  mes_example: '',
}

export const PYGMALION_CARD = {
  char_name: 'Pyg',
  char_persona: 'An old format character.',
  world_scenario: 'Somewhere.',
  char_greeting: 'Hello <USER>, I am <BOT>.',
  example_dialogue: '',
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0))
}

/** One PNG chunk. The CRC is zero: the reader does not check it. */
export function chunk(type: string, data: number[] | Uint8Array): number[] {
  return [...u32(data.length), ...ascii(type), ...data, 0, 0, 0, 0]
}

export function b64(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function tEXt(keyword: string, text: string): number[] {
  return chunk('tEXt', [...ascii(keyword), 0, ...ascii(text)])
}

export function iTXt(keyword: string, body: Uint8Array | number[], compressed = false): number[] {
  return chunk('iTXt', [...ascii(keyword), 0, compressed ? 1 : 0, 0, 0, 0, ...body])
}

/** A minimal PNG frame: signature, a fake IHDR, the given chunks, IEND. */
export function png(...chunks: number[][]): Uint8Array {
  const ihdr = chunk('IHDR', [...u32(1), ...u32(1), 8, 6, 0, 0, 0])
  return new Uint8Array([...SIG, ...ihdr, ...chunks.flat(), ...chunk('IEND', [])])
}
