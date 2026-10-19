/**
 * Fixed texts for the token estimate tests, each with the token count the real
 * tokenizers gave it (3.0.7). Deterministic, so the counts stay true: the
 * Qwen2.5 count is llama-tokenize on Qwen2.5-0.5B-Instruct (the model of the
 * Windows run), the Gemma 3 count the tokenizer.json of gemma-3-12b-it.
 */

const COLORS = ['red', 'blue', 'green', 'amber', 'violet']

/** One message of the Windows run d307-k, B5: a numeric log. */
export function lighthouseLog(part: string): string {
  let s = `d307-k B5 part 3. More log: `
  for (let i = 0; i < 330; i++) {
    s += `Line ${part}-${i}: the ${COLORS[i % 5]} lighthouse number ${(7 * i) % 101} logs ${(13 * i) % 997} ships, wind ${i % 6} knots, tide ${i % 4} meters, keeper note ${(31 * i) % 1009}. `
  }
  return s + 'Reply with OK only.'
}

const WORDS = 'keeper storm anchor bridge window morning candle meadow pebble lantern gull tide market garden island story forest harbor evening rope river baker letter winter kettle valley'.split(' ')

/** One message of B5b: common English words the tokenizer packs cheaply. */
export function cheapWords(): string {
  const out: string[] = []
  let len = 0
  for (let i = 0; len < 13000; i += 11) {
    const sentence = Array.from({ length: 12 }, (_, j) => WORDS[(i + j) % WORDS.length]).join(' ') + '. '
    out.push(sentence)
    len += sentence.length
  }
  return 'd307-k B5b turn 1. Story part: ' + out.join('') + 'Reply with OK only.'
}

/** A small linear congruential generator, so the bytes are the same everywhere. */
function bytes(n: number, seed: number): number[] {
  const out: number[] = []
  let x = seed >>> 0
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    out.push(x >>> 24)
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(b: number[]): string {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    s += i + 1 < b.length ? B64[(n >> 6) & 63] : '='
    s += i + 2 < b.length ? B64[n & 63] : '='
  }
  return s
}

const PROSE =
  'The harbour master kept a careful record of every ship that passed the lighthouse. ' +
  'In winter the storms came early, and the keeper often stayed awake through the night, ' +
  'watching the lamp and listening to the wind against the windows. When the morning ' +
  'finally arrived, he walked down to the market, bought bread from the baker and wrote ' +
  'a short letter to his sister, who lived far away in the valley beyond the forest. '

export const SAMPLES = {
  log: lighthouseLog('C'),
  words: cheapWords(),
  digits: bytes(5000, 7).map((b) => String(b % 10)).join(''),
  numbers: Array.from({ length: 1500 }, (_, i) => String(bytes(1, i + 1)[0] * 389 + i)).join(' '),
  hex: bytes(3000, 11).map((b) => b.toString(16).padStart(2, '0')).join(''),
  base64: base64(bytes(6000, 13)),
  prose: PROSE.repeat(40),
}
