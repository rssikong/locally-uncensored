import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Duplicate a chat, branch from a message, keep earlier answers (3.0.7,
// issue 174; with the edit fix of issue 172). Recorded on ddeccc9ce
// (integ/307). Facts, all from that head:
//  - lib/chat-forks.ts forkFrom: Regenerate (and Save & resend of an edited
//    message) moves the old continuation into Conversation.forks as a
//    version instead of deleting it. switchFork shows another version.
//  - components/chat/ForkSwitcher.tsx: "< 1/2 >" at the answer, buttons
//    "Previous version" / "Next version". Always visible, not hover gated
//    (MessageBubble.tsx). The arrows stop at the ends.
//  - components/chat/MessageBubble.tsx: the action bar under every message
//    (shown on hover) has "Branch from here" (GitBranch icon, title "Branch
//    from here: a new chat up to this message"); assistant messages have
//    "Regenerate response". The edit field has Cancel, Save and Save &
//    resend.
//  - components/chat/MessageList.tsx handleBranch +
//    stores/chatStore.ts duplicateConversation(id, { endAt }): a new chat
//    titled "<title> (branch)" with the history up to and including that
//    message (copyConversation slices at + 1), no versions; it opens at once.
//  - components/layout/Sidebar.tsx: the chat row has "Duplicate chat" on
//    hover and in its right click menu (both hidden in Remote Access).
//    duplicateConversation without endAt: "<title> (copy)", a full copy with
//    its kept versions, persona, system prompt, group members, sampling
//    values (fields of the conversation) and Agent, Code and documents
//    (copyConversationSideState). It opens at once.
//  - CHANGELOG 3.0.7 Known limits: these have run in automated tests only, so
//    the film shows the controls and promises nothing more.
//
// FIXTURES (said in the report too):
//  - The chat model is the rig's mocked engine with scripted answers (an
//    example bakery name, a slogan, then a second slogan for Regenerate).
//    No model runs. The chat is an example built before the film starts.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

const Q1 = 'Suggest a name for an example bakery'
const Q2 = 'Now a short slogan for it'
const A1 = 'How about Morning Crumb Bakery?'
const A2 = 'Fresh from the oven, every morning.'
const A3 = 'Warm bread, early birds.'

test('chat-branch', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const rec = await Rec.boot(page, 'chat-branch', 'Branch and duplicate a chat', {
    mode: 'local',
    tauri: {
      platform: 'windows',
      agentTurns: [{ text: A1 }, { text: A2 }, { text: A3 }],
    },
  })

  // The example chat: two questions, two answers. Built before the film.
  await expect(async () => {
    await page.getByRole('button', { name: /New Chat/i }).first().click()
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const composer = page.locator('textarea').first()
  // A second message waits until the first turn has let go of the local
  // lane (a few seconds in the rig), so the send is retried until it goes.
  const ask = async (q: string, a: string) => {
    await expect(async () => {
      await composer.fill(q)
      await composer.press('Enter')
      await expect(composer).toHaveValue('', { timeout: 1_000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByText(a)).toBeVisible({ timeout: 30_000 })
  }
  await ask(Q1, A1)
  await ask(Q2, A2)
  // The chat list open, so Duplicate chat is in view, and the example chat
  // renamed to a short title through Rename in its right click menu.
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  const rowOf = (t: string) => page.locator(`aside p[title="${t}"]`)
  await page.locator('aside p[title="Suggest a name for an example bakery"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Example bakery')
  await page.keyboard.press('Enter')
  await expect(rowOf('Example bakery')).toBeVisible()
  await page.mouse.move(1380, 860)
  await page.waitForTimeout(1200)

  const bubble = (t: string) => page.getByText(t, { exact: true }).locator('xpath=ancestor::div[contains(@class,"group")][1]')

  await rec.key()
  rec.scene('Regenerate keeps the earlier answer as a version.')
  const last = bubble(A2)
  await rec.cam({ x: 700, y: 330 }, 1.4, 0.9)
  await rec.move(last, { dur: 0.6, at: { fx: 0.3 } })
  await rec.key(300)
  await rec.click(last.getByRole('button', { name: 'Regenerate response' }), {
    dur: 0.5, after: 0.3,
    until: () => expect(page.getByText(A3)).toBeVisible({ timeout: 30_000 }),
  })
  const switcher = page.getByTestId('fork-switcher')
  await expect(switcher).toHaveAttribute('aria-label', 'Version 2 of 2')
  rec.hold(0.7)

  rec.scene('The arrows on the answer switch between the versions.')
  await rec.click(switcher.getByRole('button', { name: 'Previous version' }), {
    dur: 0.6, after: 0.3,
    until: () => expect(page.getByText(A2)).toBeVisible(),
  })
  await expect(switcher).toHaveAttribute('aria-label', 'Version 1 of 2')
  rec.hold(1.0)

  rec.scene('Branch from here starts a new chat with the history up to that message.')
  const first = bubble(A1)
  await rec.move(first, { dur: 0.6, at: { fx: 0.3 } })
  await rec.key(300)
  await rec.click(first.getByRole('button', { name: 'Branch from here' }), {
    dur: 0.5, after: 0.3,
    until: () => expect(rowOf('Example bakery (branch)')).toBeVisible(),
  })
  await expect(page.getByText(A2)).toHaveCount(0)
  await rec.cam('full', 1, 0.9)
  // Off the new chat's own action bar, so nothing there reads as pressed.
  await rec.move({ x: 1000, y: 620 }, { dur: 0.5 })
  await rec.key(300)
  rec.hold(0.8)

  rec.scene('Duplicate chat in the chat list makes a full copy, kept versions included.')
  const orig = rowOf('Example bakery')
  await rec.cam({ x: 560, y: 300 }, 1.4, 0.9)
  await rec.move(orig, { dur: 0.6, at: { fx: 0.4 } })
  await rec.key(300)
  const origRow = orig.locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await rec.click(origRow.getByRole('button', { name: 'Duplicate chat' }), {
    dur: 0.5, after: 0.3,
    until: () => expect(rowOf('Example bakery (copy)')).toBeVisible(),
  })
  await expect(page.getByTestId('fork-switcher')).toHaveAttribute('aria-label', 'Version 1 of 2')
  await page.mouse.move(1380, 860)
  await rec.cam('full', 1, 0.9)
  await rec.key(300)
  rec.hold(1.4)
  rec.finish(1.0)
})
