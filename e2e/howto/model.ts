import type { Page } from '@playwright/test'

/**
 * A scripted model for the Code and Agent how-tos.
 *
 * FIXTURE, not UI: the rig's cloud mock answers no chat at all (404 on
 * /api/inference/v1/chat/completions), so a run could never start. This routes
 * that one endpoint and answers with the turns a spec lists, in order, in the
 * same streaming shape the cloud speaks (e2e/cloud-agent-tab-switch.spec.ts
 * does the same). Everything the film shows after that (staged edits, the plan
 * card, the loop bar, the approval strip) is drawn by the app itself from
 * these answers; no DOM is touched.
 */
export type Turn = { text?: string; toolCalls?: Array<{ name: string; args: Record<string, unknown> }> }

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' }

export async function scriptModel(page: Page, turns: Turn[], opts: { stepMs?: number } = {}) {
  const bodies: string[] = []
  let n = 0
  await page.route('**/api/inference/v1/chat/completions', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    bodies.push(route.request().postData() ?? '')
    const i = n++
    const turn = turns[Math.min(i, turns.length - 1)]
    if (opts.stepMs) await new Promise((r) => setTimeout(r, opts.stepMs))
    const chunks: unknown[] = []
    if (turn.text) chunks.push({ choices: [{ index: 0, delta: { role: 'assistant', content: turn.text }, finish_reason: null }] })
    const calls = (turn.toolCalls ?? []).map((c, k) => ({
      index: k, id: `call_${i}_${k}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) },
    }))
    if (calls.length) chunks.push({ choices: [{ index: 0, delta: { tool_calls: calls }, finish_reason: null }] })
    chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] })
    const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    return route.fulfill({ status: 200, headers: cors, contentType: 'text/event-stream', body: sse }).catch(() => {})
  })
  return bodies
}

/** Picks the chat model in the composer's picker (a run needs one). */
export async function pickModel(page: Page, name = /GLM 5\.3 Flash/) {
  await page.getByRole('button', { name: 'Select chat model', exact: true }).click()
  await page.getByRole('button', { name }).first().click()
}

/**
 * Into Code mode with a model picked and a coding chat open, the sidebar back
 * on its rail. All through the real controls; done before the film starts.
 */
export async function openCode(page: Page) {
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await page.locator('aside').getByRole('button', { name: /^Code/ }).first().click()
  await page.getByText('Send a coding instruction.').waitFor()
  await pickModel(page)
  // The mode dropdown needs a conversation ("the mode lives on the
  // conversation"); a New Chat click before the model list is in is ignored.
  for (let i = 0; i < 20; i++) {
    await page.getByRole('button', { name: /New Chat/i }).first().click()
    if (await page.getByText('No code chats yet.').isHidden()) break
    await page.waitForTimeout(500)
  }
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await page.waitForTimeout(700)
}

/** A new chat with a model picked, so the Agent switch is there to be used. */
export async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await pickModel(page)
  const toggle = page.getByRole('main').getByRole('button', { name: 'Agent', exact: true })
  for (let i = 0; i < 20; i++) {
    if (await toggle.isVisible().catch(() => false)) break
    await page.getByRole('button', { name: /New Chat/i }).first().click()
    await page.waitForTimeout(500)
  }
  await page.getByRole('button', { name: 'Toggle sidebar' }).click()
  await page.waitForTimeout(700)
  return toggle
}
