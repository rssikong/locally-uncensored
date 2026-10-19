// @vitest-environment jsdom
/**
 * 3.0.5, a user on Discord: the clip takes any file, not only images.
 *
 * What the composer owes the user: the file shows up as a chip like the image
 * previews do (name, the type read from its bytes, its size), it can be taken
 * off again, it travels with the send, and a file that is too large is
 * refused in plain English at the head of the transcript, never inside the
 * prompt box.
 *
 * The file is read for real here (jsdom File, WebCrypto), nothing of
 * lib/chat-files.ts is mocked.
 *
 * Run: npx vitest run src/components/chat/__tests__/any-file-attaches-as-a-chip.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { MessageBubble } from '../MessageBubble'
import { useChatStore } from '../../../stores/chatStore'
import { useChatNoticeStore } from '../../../stores/chatNoticeStore'
import { MAX_CHAT_FILE_BYTES, MAX_CHAT_FILES, type ChatFileInput } from '../../../lib/chat-files'

function rom(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(1024)
  bytes.set([0x4e, 0x45, 0x53, 0x1a, 0x02, 0x01], 0)
  bytes.set([...'SUPER MARIO BROS'].map((c) => c.charCodeAt(0)), 0x40)
  return bytes
}

beforeEach(() => {
  useChatStore.setState({ activeConversationId: 'a' })
  useChatNoticeStore.getState().clear()
})
afterEach(cleanup)

function setup({ filesReachTools = false } = {}) {
  const send = vi.fn()
  const { container } = render(<ChatInput onSend={send} onStop={() => {}} isGenerating={false} modelReady={() => true} filesReachTools={filesReachTools} />)
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!
  const attach = (...files: File[]) => fireEvent.change(input, { target: { files } })
  return { send, attach, input }
}

const notices = () => useChatNoticeStore.getState().notices.map((n) => n.text)

describe('the clip takes any file', () => {
  it('no longer limits the picker to images', () => {
    const { input } = setup()
    expect(input.getAttribute('accept')).toBeNull()
    expect(screen.getByTitle('Attach images or files')).toBeTruthy()
  })

  it('a ROM becomes a chip with its name, its detected type and its size', async () => {
    const { attach } = setup()
    attach(new File([rom()], 'mario.nes'))
    const chip = await screen.findByTestId('composer-file-chip')
    expect(chip.textContent).toContain('mario.nes')
    expect(chip.textContent).toContain('NES ROM (iNES), 1.0 KB')
  })

  it('plain chat: a binary gets one line above the transcript, naming it and the way to the file itself', async () => {
    const { attach } = setup()
    attach(new File([rom()], 'mario.nes'))
    await screen.findByTestId('composer-file-chip')
    await waitFor(() => expect(notices()).toEqual([
      'Models cannot read binary files. "mario.nes" (NES ROM (iNES), 1.0 KB) reaches the model as a short summary only. To let it work on the file itself, turn on Agent mode or use Code: the file is then put into the working folder, where the model\'s tools can open it.',
    ]))
    expect(useChatNoticeStore.getState().notices[0]).toMatchObject({ id: 'binary-summary-only', ton: 'ruhig' })
    // Above the transcript, never inside the prompt box.
    expect(screen.queryByText(/cannot read binary files/)).toBeNull()
  })

  it('Agent and Code: no such line, the file goes into the working folder', async () => {
    const { attach } = setup({ filesReachTools: true })
    attach(new File([rom()], 'mario.nes'))
    await screen.findByTestId('composer-file-chip')
    expect(notices()).toEqual([])
  })

  it('plain chat: a text file needs no such line, the model reads its text', async () => {
    const { attach } = setup()
    attach(new File(['just some notes'], 'notes.txt'))
    await screen.findByTestId('composer-file-chip')
    expect(notices()).toEqual([])
  })

  it('sends the typed text and the file, and clears the draft', async () => {
    const { send, attach } = setup()
    attach(new File([rom()], 'mario.nes'))
    await screen.findByTestId('composer-file-chip')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'what game is this?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(send).toHaveBeenCalledTimes(1)
    const [text, images, files] = send.mock.calls[0] as [string, unknown, ChatFileInput[]]
    expect(text).toBe('what game is this?')
    expect(images).toBeUndefined()
    expect(files).toHaveLength(1)
    expect(files[0].attachment).toMatchObject({ name: 'mario.nes', size: 1024, kind: 'NES ROM (iNES)' })
    expect(files[0].attachment.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(files[0].attachment.summary).toContain('SUPER MARIO BROS')
    // The handle to the bytes goes along for the working folder copy.
    expect(files[0].file).toBeInstanceOf(File)
    expect(screen.queryByTestId('composer-file-chip')).toBeNull()
  })

  it('a file alone can be sent, with a placeholder as the text', async () => {
    const { send, attach } = setup()
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true)
    attach(new File([rom()], 'mario.nes'))
    await screen.findByTestId('composer-file-chip')
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(send.mock.calls[0][0]).toBe('(file)')
  })

  it('the x on the chip takes the file off again', async () => {
    const { send, attach } = setup()
    attach(new File([rom()], 'mario.nes'))
    await screen.findByTestId('composer-file-chip')
    fireEvent.click(screen.getByRole('button', { name: 'Remove mario.nes' }))
    expect(screen.queryByTestId('composer-file-chip')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    // Without files the handler is called exactly as it always was.
    expect(send).toHaveBeenCalledWith('hello', undefined)
  })

  it('a file over the limit is refused in plain English, above the transcript', async () => {
    const { attach } = setup()
    const huge = new File(['x'], 'disc.iso')
    Object.defineProperty(huge, 'size', { value: MAX_CHAT_FILE_BYTES + 1 })
    attach(huge)
    await waitFor(() => expect(notices()).toEqual(['"disc.iso" is too large. You can attach files up to 256.0 MB.']))
    expect(screen.queryByTestId('composer-file-chip')).toBeNull()
    // The sentence is not drawn inside the composer.
    expect(screen.queryByText(/is too large/)).toBeNull()
  })

  it(`takes ${MAX_CHAT_FILES} files per message and says so for the rest`, async () => {
    const { attach } = setup()
    attach(...[1, 2, 3, 4].map((n) => new File([`file ${n}`], `note-${n}.txt`)))
    await waitFor(() => expect(screen.getAllByTestId('composer-file-chip')).toHaveLength(MAX_CHAT_FILES))
    expect(notices()).toEqual([`You can attach up to ${MAX_CHAT_FILES} files per message.`])
  })

  it('a PDF attaches too, and the line points to the Documents panel', async () => {
    const { attach } = setup()
    attach(new File(['%PDF-1.7\n', new Uint8Array([0xff, 0x00, 0xfe])], 'paper.pdf'))
    const chip = await screen.findByTestId('composer-file-chip')
    expect(chip.textContent).toContain('PDF document')
    expect(notices()).toEqual(['The model only gets a summary of this document. To ask about its text, add it in the Documents panel.'])
  })

  it('the draft with its file belongs to the chat it was started in', async () => {
    const { attach } = setup()
    attach(new File([rom()], 'mario.nes'))
    await screen.findByTestId('composer-file-chip')
    act(() => useChatStore.setState({ activeConversationId: 'b' }))
    expect(screen.queryByTestId('composer-file-chip')).toBeNull()
    act(() => useChatStore.setState({ activeConversationId: 'a' }))
    expect(screen.getByTestId('composer-file-chip').textContent).toContain('mario.nes')
  })

  it('an image still goes the image way, not the file way', async () => {
    const { attach } = setup()
    attach(new File(['not really a png'], 'shot.png', { type: 'image/png' }))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByTestId('composer-file-chip')).toBeNull()
  })
})

describe('the transcript shows the chip, not the summary', () => {
  const message = {
    id: 'u1',
    role: 'user' as const,
    content: 'what game is this?\n\n[Attached file: mario.nes]\nHEXDUMP-MARKER\n[End of attached file: mario.nes]',
    displayContent: 'what game is this?',
    files: [{ name: 'mario.nes', size: 1024, kind: 'NES ROM (iNES)', sha256: 'ab'.repeat(32), summary: 'HEXDUMP-MARKER' }],
    timestamp: 1,
  }

  it('draws what was typed and a chip per file', () => {
    render(<MessageBubble message={message} />)
    expect(screen.getByText('what game is this?')).toBeTruthy()
    expect(screen.getByTestId('chat-file-chip').textContent).toContain('mario.nes')
    expect(screen.getByTestId('chat-file-chip').textContent).toContain('NES ROM (iNES), 1.0 KB')
    expect(screen.queryByText(/HEXDUMP-MARKER/)).toBeNull()
    // In the transcript the chip has no x: the message is sent.
    expect(screen.queryByRole('button', { name: 'Remove mario.nes' })).toBeNull()
  })

  it('a message that was only a file shows the chip alone', () => {
    render(<MessageBubble message={{ ...message, displayContent: '(file)' }} />)
    expect(screen.getByTestId('chat-file-chip')).toBeTruthy()
    expect(screen.queryByText('(file)')).toBeNull()
  })
})
