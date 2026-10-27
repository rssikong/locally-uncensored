/**
 * Round 6, acceptance on Android 8 GB.
 *
 * B5: the row of a PDF that could not be read said "Failed to extract text
 * from "harrowgate-logbook.pdf": Promise.withResolvers is not a function".
 * The cause is fixed elsewhere (lib/webview-polyfills.ts). This holds the
 * other half: the words of the script engine never reach a user.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/documents-round6.test.ts
 */
import { describe, expect, it } from 'vitest'
import { reasonForUser } from '../parts/documents-logic'

describe('why a file was not read, for the user', () => {
  it('the words of the script engine are not shown', () => {
    for (const tail of [
      'Promise.withResolvers is not a function',
      'undefined is not an object (evaluating \'a.b\')',
      "Cannot read properties of undefined (reading 'length')",
      'x is not defined',
      'Unexpected token <',
    ]) {
      expect(reasonForUser(`Failed to extract text from "harrowgate-logbook.pdf": ${tail}`), tail).toBeUndefined()
    }
  })

  it('a reason about the file itself still is', () => {
    // Since round 35 (D1) without "Failed to extract text from": the row starts with "Failed." already.
    expect(reasonForUser('Failed to extract text from "notes.pdf": Invalid PDF structure.')).toBe('LU could not read "notes.pdf": Invalid PDF structure.')
    expect(reasonForUser('No text could be extracted from this file.')).toBe('No text could be extracted from this file.')
  })
})
