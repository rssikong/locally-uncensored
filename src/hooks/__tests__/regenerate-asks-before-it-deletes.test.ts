/**
 * Bug hunt 01.10.2026 (H9). Regenerate and Edit delete the turn and then call
 * sendMessage. resend checked for a model, but sendMessage also refuses a
 * model from the other mode (Local/Cloud switch) and a second send while this
 * conversation's run is in flight. Either way the question was gone and
 * nothing went out. resend now asks all three before it deletes.
 *
 * Since GH #172 the turn is not deleted but moved aside as a kept version
 * (`forkFrom`); the order of the checks still matters, so a refused resend
 * does not even move it.
 */
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const chat = readFileSync(resolve(__dirname, '..', 'useChat.ts'), 'utf8')

it('resend refuses what sendMessage refuses, before the turn is moved aside', () => {
  const at = chat.indexOf('const resend = useCallback(')
  const body = chat.slice(at, chat.indexOf('}, [sendMessage, sendCreateReport])', at))
  const del = body.indexOf('forkFrom(')
  expect(del).toBeGreaterThan(0)
  expect(body).not.toContain('deleteMessagesAfter')
  const mode = body.indexOf('modelOutOfMode(activeModel, useSettingsStore.getState().settings.appMode)) return false')
  const run = body.indexOf('if (activeChatRuns.has(conversationId)) return false')
  expect(mode).toBeGreaterThan(0)
  expect(run).toBeGreaterThan(0)
  expect(mode).toBeLessThan(del)
  expect(run).toBeLessThan(del)
  // The same two refusals sendMessage applies.
  expect(chat).toContain('if (modelOutOfMode(activeModel, settings.appMode)) {')
  expect(chat).toContain('if (activeChatRuns.has(convId)) {')
})
