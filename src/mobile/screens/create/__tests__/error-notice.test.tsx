// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const copyText = vi.fn(async (_text: string) => true)
vi.mock('../../../platform/clipboard', () => ({ copyText: (text: string) => copyText(text) }))

import { ErrorNotice } from '../parts/ErrorNotice'

afterEach(() => {
  cleanup()
  copyText.mockClear()
})

describe('the error box of Create', () => {
  it('offers the wording of the server for an error without an own sentence', async () => {
    const raw = 'upstream worker 7 answered 502 while decoding'
    render(<ErrorNotice message={raw} stillBooked={false} onRetry={() => {}} />)
    fireEvent.click(screen.getByTestId('m-create-error-copy'))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(raw))
    expect(screen.getByTestId('m-create-error-copy').textContent).toBe('Copy details')
  })

  it('shows no copy button where the app explains the error itself', () => {
    render(<ErrorNotice message="Failed to fetch" stillBooked={false} onRetry={() => {}} />)
    expect(screen.queryByTestId('m-create-error-copy')).toBeNull()
    expect(screen.getByTestId('m-create-error-action')).toBeTruthy()
  })
})
