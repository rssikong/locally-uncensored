// @vitest-environment jsdom
/**
 * "Your phone is creating": shown only while a phone's job runs on this
 * computer, with Cancel going to the same cancel as the phone's.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

const calls = vi.hoisted(() => ({ list: [] as Array<{ cmd: string; args: unknown }> }))
vi.mock('../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  isTauri: () => true,
  backendCall: vi.fn(async (cmd: string, args: unknown) => { calls.list.push({ cmd, args }); return null }),
}))

import { RemoteCreateBar } from '../RemoteCreateBar'
import { useRemoteCreateStore } from '../../../lib/remote-create-runner'

afterEach(() => { cleanup(); useRemoteCreateStore.setState({ running: null, queued: 0 }); calls.list = [] })

describe('the bar for a phone creating', () => {
  it('is not there without a job', () => {
    const { container } = render(<RemoteCreateBar />)
    expect(container.textContent).toBe('')
  })

  it('says what runs and how far, and Cancel ends that job', async () => {
    useRemoteCreateStore.setState({ running: { id: 'job_9', kind: 'image', prompt: 'a cat', progress: 0.42, step_text: 'Step 8 of 20', count: 1 }, queued: 1 })
    render(<RemoteCreateBar />)
    expect(screen.getByRole('status').textContent).toContain('Your phone is creating an image on this computer: Step 8 of 20 (42%), 1 more waiting')
    fireEvent.click(screen.getByRole('button', { name: "Cancel the phone's job" }))
    await vi.waitFor(() => expect(calls.list).toEqual([{ cmd: 'remote_create_cancel', args: { id: 'job_9' } }]))
  })
})
