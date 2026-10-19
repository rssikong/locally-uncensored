// @vitest-environment jsdom
/**
 * The persona panel imports a character card (3.0.7): a good card becomes the
 * active persona, a broken one gives a sentence and no persona, creator notes
 * are shown, and a card persona can be exported again.
 *
 * Run: npx vitest run src/components/personas/__tests__/character-card-import.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PersonaPanel } from '../PersonaPanel'
import { GreetingSwitcher } from '../../chat/GreetingSwitcher'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useChatStore } from '../../../stores/chatStore'
import { BUILT_IN_PERSONAS } from '../../../lib/constants'
import { V2_CARD, b64, png, tEXt } from '../../../lib/__tests__/character-card-fixtures'

const downloads: { content: string; name: string }[] = []
vi.mock('../../../lib/chat-export', async (orig) => ({
  ...(await orig<typeof import('../../../lib/chat-export')>()),
  downloadFile: (content: string, name: string) => { downloads.push({ content, name }) },
}))

// jsdom draws no images; the shrinking itself needs a real WebView.
vi.mock('../../../lib/character-card-files', async (orig) => ({
  ...(await orig<typeof import('../../../lib/character-card-files')>()),
  cardImageDataUrl: async () => 'data:image/jpeg;base64,AAAA',
}))

beforeEach(() => {
  downloads.length = 0
  useSettingsStore.setState({ personas: BUILT_IN_PERSONAS, activePersonaId: 'unrestricted' })
  useSettingsStore.getState().updateSettings({ personasEnabled: true })
  useChatStore.setState({ conversations: [], activeConversationId: null })
})
afterEach(() => cleanup())

function pick(file: File) {
  fireEvent.change(screen.getByTestId('card-file-input'), { target: { files: [file] } })
}

describe('importing a character card in the persona panel', () => {
  it('turns a PNG card into the active persona and shows its creator notes', async () => {
    render(<PersonaPanel />)
    pick(new File([png(tEXt('chara', b64(V2_CARD))) as BlobPart], 'mira.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByTestId('card-message').textContent).toMatch(/Imported Mira/))
    const { personas, activePersonaId } = useSettingsStore.getState()
    const mira = personas.find((p) => p.name === 'Mira')!
    expect(mira.card?.firstMessage).toBe(V2_CARD.data.first_mes)
    expect(activePersonaId).toBe(mira.id)
    expect(mira.imageDataUrl).toBe('data:image/jpeg;base64,AAAA')
    expect(document.querySelector('img[src^="data:image/jpeg"]')).toBeTruthy()
    expect(screen.getByTestId('card-creator-notes').textContent).toContain('slow paced scenes')
  })

  it('reads a JSON card and exports it again', async () => {
    render(<PersonaPanel />)
    pick(new File([JSON.stringify(V2_CARD)], 'mira.json', { type: 'application/json' }))
    await waitFor(() => expect(screen.getByText('Mira')).toBeTruthy())
    expect(useSettingsStore.getState().personas.find((p) => p.name === 'Mira')?.imageDataUrl).toBeUndefined()
    fireEvent.click(screen.getByTitle('Export as character card'))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].name).toBe('Mira.json')
    expect(JSON.parse(downloads[0].content).data).toEqual(V2_CARD.data)
  })

  it('says what is wrong with a broken file and adds nothing', async () => {
    render(<PersonaPanel />)
    const before = useSettingsStore.getState().personas.length
    pick(new File([png(tEXt('Comment', 'x')) as BlobPart], 'cat.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no character card inside/))
    pick(new File(['{oops'], 'bad.json'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not valid JSON/))
    expect(useSettingsStore.getState().personas.length).toBe(before)
  })
})

describe('the greeting switcher', () => {
  it('steps through the greetings with wrap around', () => {
    const id = useChatStore.getState().createConversation('m', '', 'lu')
    const msg = { id: 'g', role: 'assistant' as const, content: 'A', greetings: ['A', 'B', 'C'], greetingIndex: 0, timestamp: 1 }
    useChatStore.getState().addMessage(id, msg)
    const view = () => {
      const m = useChatStore.getState().conversations[0].messages[0]
      cleanup()
      render(<GreetingSwitcher conversationId={id} message={m} />)
      return m
    }
    view()
    expect(screen.getByTestId('greeting-switcher').textContent).toContain('1 / 3')
    fireEvent.click(screen.getByLabelText('Previous greeting'))
    expect(view().content).toBe('C')
    expect(screen.getByTestId('greeting-switcher').textContent).toContain('3 / 3')
    fireEvent.click(screen.getByLabelText('Next greeting'))
    expect(view().content).toBe('A')
  })
})
