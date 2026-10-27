/**
 * @vitest-environment jsdom
 *
 * A draft survives a trip to another part of the app (3.0.8, a feature
 * request on Discord, 20.10.2026).
 *
 * Chat and Code unmount when the user opens Create, Models or Settings, and
 * the composer went with them: the half-written message and its attachments
 * were gone on the way back. The composer now lays its drafts down in
 * lib/chat-drafts.ts when it unmounts and picks them up on the next mount,
 * per chat, like the switch between chats already did.
 *
 * Run: npx vitest run src/components/chat/__tests__/der-entwurf-ueberlebt-den-bereichswechsel.test.tsx
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { useChatStore } from '../../../stores/chatStore'
import { clearChatDrafts, loadChatDrafts, newChatKey, storeChatDrafts } from '../../../lib/chat-drafts'

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement
const composer = (scope?: string) => render(<ChatInput onSend={vi.fn()} onStop={() => {}} isGenerating={false} draftScope={scope} />)
const open = (id: string | null) => act(() => { useChatStore.setState({ activeConversationId: id }) })

beforeEach(() => {
  cleanup()
  clearChatDrafts()
  useChatStore.setState({ activeConversationId: null })
})

describe('leaving the view keeps the draft', () => {
  it('the text of the open chat is back after the view closed and opened again', () => {
    open('chat-a')
    const first = composer()
    fireEvent.change(box(), { target: { value: 'half a sentence' } })
    first.unmount()
    composer()
    expect(box().value).toBe('half a sentence')
  })

  it('each chat keeps its own draft, the ones switched away from included', () => {
    open('chat-a')
    const first = composer()
    fireEvent.change(box(), { target: { value: 'for A' } })
    open('chat-b')
    expect(box().value).toBe('')
    fireEvent.change(box(), { target: { value: 'for B' } })
    first.unmount()

    open('chat-a')
    composer()
    expect(box().value).toBe('for A')
    open('chat-b')
    expect(box().value).toBe('for B')
  })

  it('images and files come back with their text', () => {
    storeChatDrafts({
      'chat-a': {
        text: 'look at this',
        bilder: [{ data: 'aGVsbG8=', mimeType: 'image/png', name: 'shot.png' }],
        dateien: [{ attachment: { name: 'notes.txt', mimeType: 'text/plain', size: 12, kind: 'text', text: 'twelve bytes', summary: 'twelve bytes' } as never }],
      },
    })
    open('chat-a')
    composer()
    expect(box().value).toBe('look at this')
    expect(screen.getByAltText('shot.png')).toBeTruthy()
    expect(screen.getByText(/notes\.txt/)).toBeTruthy()
  })

  it('an empty field leaves nothing behind, so a sent message does not come back', () => {
    open('chat-a')
    const first = composer()
    fireEvent.change(box(), { target: { value: 'typed' } })
    fireEvent.change(box(), { target: { value: '' } })
    first.unmount()
    expect(loadChatDrafts()).toEqual({})
  })

  it('a draft typed before a chat exists stays with its composer, Chat apart from Code', () => {
    const chat = composer('chat')
    fireEvent.change(box(), { target: { value: 'new chat text' } })
    chat.unmount()
    expect(Object.keys(loadChatDrafts())).toEqual([newChatKey('chat')])

    const code = composer('code')
    expect(box().value).toBe('')
    code.unmount()
    composer('chat')
    expect(box().value).toBe('new chat text')
  })
})
