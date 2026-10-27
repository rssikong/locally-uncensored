/**
 * A tap on Send is never dropped without a word (acceptance Android, re-run,
 * N3: once, under heavy load, the first tap after the onboarding sent nothing
 * and the text stood in the field for five minutes).
 *
 * The run could not be repeated, and no race between "the model is ready" and
 * the button was found: the handler is attached with the button, and a send
 * while the model still loads waits for the load in the logic layer. What the
 * way from the tap to the hand over did have were two exits without a word.
 * This file holds that every exit of `send` in ChatPage either hands the
 * message over or says something on screen.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_STRINGS as S } from '../../../strings/chat'

const page = readFileSync(join(__dirname, '..', 'ChatPage.tsx'), 'utf8')
const send = page.slice(page.indexOf('const send = useCallback('), page.indexOf('const submit = () =>'))

describe('the send path of the chat page', () => {
  it('is found in the source', () => {
    expect(send.length).toBeGreaterThan(400)
  })

  it('a new chat that could not be created says so and leaves the text', () => {
    const at = send.indexOf('if (!newId)')
    expect(at).toBeGreaterThan(0)
    const exit = send.slice(at, send.indexOf('setPendingSend('))
    expect(exit).toContain("toast(S.chat.chooseFirst")
    expect(exit).toContain('openModels()')
    // The draft is only cleared after the chat exists.
    expect(send.indexOf('if (!newId)')).toBeLessThan(send.indexOf('useDraftStore.getState().clear(draftKey)'))
  })

  it('an error between the tap and the hand over is said, and the text is put back', () => {
    const at = send.indexOf('.catch(')
    expect(at).toBeGreaterThan(0)
    const exit = send.slice(at)
    expect(exit).toContain("testid: 'send-failed'")
    expect(exit).toContain('setText(draftKey, text)')
  })

  it('every return without a hand over has a sentence before it, except the empty message and the declined consent', () => {
    // The declined consent is said by cloudAllowed itself (parts/consent.ts).
    const consent = readFileSync(join(__dirname, '..', 'parts', 'consent.ts'), 'utf8')
    expect(consent).toContain("toast(CHAT_STRINGS.policy.notSent")
    const returns = [...send.matchAll(/\n( *)return\n/g)].map((m) => send.slice(Math.max(0, (m.index ?? 0) - 160), m.index))
    const silent = returns.filter((before) => !/toast\(|nav\.replace\(/.test(before))
    expect(silent).toEqual([])
  })

  it('the sentences are the ones the user can act on', () => {
    expect(S.chat.chooseFirst).toContain('Your message is kept')
    expect(S.policy.notSent).toContain('still in the field')
  })
})
