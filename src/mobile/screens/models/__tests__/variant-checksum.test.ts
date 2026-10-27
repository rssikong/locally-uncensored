/**
 * The checksum row of a file that is another packing of a catalogue model
 * (iPhone review, N5): "Checked while downloading" before the download and
 * "Not listed by the source" after it. The digest is in the record of the
 * download, and the page of the file reads it there.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkedDigest } from '../parts/catalog'

describe('the digest a download was checked against', () => {
  const records = {
    'Qwen3.5-2B-UD-IQ2_XXS.gguf': { sha256: 'ab12cd' },
    'no-digest.gguf': {},
    'blank.gguf': { sha256: '   ' },
  }

  it('comes from the record of that download', () => {
    expect(checkedDigest(records, 'Qwen3.5-2B-UD-IQ2_XXS.gguf')).toBe('ab12cd')
  })

  it('a file without a record, or a record without a digest, claims nothing', () => {
    expect(checkedDigest(records, 'brought-in-by-hand.gguf')).toBeUndefined()
    expect(checkedDigest(records, 'no-digest.gguf')).toBeUndefined()
    expect(checkedDigest(records, 'blank.gguf')).toBeUndefined()
  })

  it('the detail page gives it to the file it shows', () => {
    const page = readFileSync(join(__dirname, '../ModelDetailPage.tsx'), 'utf8')
    expect(page).toContain('sha256: checkedDigest(digests, `${fileOnPhone.name}.gguf`)')
    expect(page).toContain('const digests = useDownloadStore((s) => s.downloadMeta)')
  })
})
