// @vitest-environment jsdom
/**
 * The base components in a DOM: the marks a test and an inventory read
 * (data-m-risk, data-m-id, data-state), the choices of a row, the two
 * buttons of a banner, and that a title with break points is still the same
 * text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Trash2 } from 'lucide-react'
import { PageContext, SheetContext } from '../../nav/context'
import type { PageEntry, SheetEntry } from '../../nav/types'
import { Markdown } from '../Markdown'
import { Segmented } from '../Segmented'
import { Banner, Button, Chip, Composer, Fold, IconButton, ListGroup, MiddleEllipsis, NumberField, Page, PermissionRow, Row, SecretField, Sheet } from '..'

afterEach(() => {
  cleanup()
})

describe('risk marks', () => {
  it('Button, IconButton, Chip and Row write data-m-risk on the target itself', () => {
    render(
      <>
        <Button risk="paid" testid="b">
          Create
        </Button>
        <IconButton icon={Trash2} label="Remove" risk="destructive" testid="i" />
        <Chip kind="action" risk="paid" testid="c">
          Upscale
        </Chip>
        <Row title="Delete account" onPress={() => {}} risk="destructive" testid="r" />
        <Row title="A fact" risk="destructive" testid="static" />
        <Button testid="plain">Plain</Button>
      </>,
    )
    expect(screen.getByTestId('b').getAttribute('data-m-risk')).toBe('paid')
    expect(screen.getByTestId('b').tagName).toBe('BUTTON')
    expect(screen.getByTestId('i').getAttribute('data-m-risk')).toBe('destructive')
    expect(screen.getByTestId('c').getAttribute('data-m-risk')).toBe('paid')
    expect(screen.getByTestId('r').getAttribute('data-m-risk')).toBe('destructive')
    expect(screen.getByTestId('r').tagName).toBe('BUTTON')
    expect(screen.getByTestId('static').getAttribute('data-m-risk')).toBe('destructive')
    expect(screen.getByTestId('plain').hasAttribute('data-m-risk')).toBe(false)
  })

  it('the two marks for what leaves the app or opens a sensor are written the same way', () => {
    render(
      <>
        <Row title="Website" onPress={() => {}} risk="leaves-app" testid="link" />
        <Button risk="sensor" testid="camera">
          Take photo
        </Button>
        <IconButton icon={Trash2} label="Share" risk="leaves-app" testid="share" />
        <Markdown content="[a link](https://example.test)" />
      </>,
    )
    expect(screen.getByTestId('link').getAttribute('data-m-risk')).toBe('leaves-app')
    expect(screen.getByTestId('camera').getAttribute('data-m-risk')).toBe('sensor')
    expect(screen.getByTestId('share').getAttribute('data-m-risk')).toBe('leaves-app')
    // A link in an answer opens the browser after a question; the link itself carries the mark.
    expect(screen.getByTestId('m-md-link').getAttribute('data-m-risk')).toBe('leaves-app')
  })

  it('the Composer marks its send button, and only that', () => {
    const { rerender } = render(<Composer value="A prompt" onChange={() => {}} onSend={() => {}} risk="paid" idPrefix="x" testid="wrap" />)
    expect(screen.getByTestId('x-send').getAttribute('data-m-risk')).toBe('paid')
    expect(screen.getByTestId('wrap').hasAttribute('data-m-risk')).toBe(false)
    expect(screen.getByTestId('x-input').hasAttribute('data-m-risk')).toBe(false)
    rerender(<Composer value="A prompt" onChange={() => {}} onSend={() => {}} idPrefix="x" />)
    expect(screen.getByTestId('x-send').hasAttribute('data-m-risk')).toBe(false)
    // Stop costs nothing.
    rerender(<Composer value="" onChange={() => {}} onSend={() => {}} running onStop={() => {}} risk="paid" idPrefix="x" />)
    expect(screen.getByTestId('x-stop').hasAttribute('data-m-risk')).toBe(false)
  })
})

describe('Row', () => {
  it('carries the id of its entry and a state next to the test id', () => {
    render(
      <ListGroup>
        <Row title="Gemma 3 4B" id="gemma" state="loaded" onPress={() => {}} testid="m-model-row" />
        <Row title="Qwen 2.5 3B" id="qwen" onPress={() => {}} testid="m-model-row" trailing={<IconButton icon={Trash2} label="Remove Qwen" />} />
      </ListGroup>,
    )
    const rows = screen.getAllByTestId('m-model-row')
    expect(rows.map((row) => row.getAttribute('data-m-id'))).toEqual(['gemma', 'qwen'])
    expect(rows[0].getAttribute('data-state')).toBe('loaded')
    expect(rows[1].hasAttribute('data-state')).toBe(false)
    // With a second target the marks stay on the main target, not on the frame around both.
    expect(rows[1].tagName).toBe('BUTTON')
  })

  it('a tap on the chosen radio row does nothing, unless the row asks for it', () => {
    const quiet = vi.fn()
    const again = vi.fn()
    render(
      <ListGroup role="radiogroup" label="Model">
        <Row title="Quiet" radio={{ checked: true, onSelect: quiet }} testid="quiet" />
        <Row title="Again" radio={{ checked: true, onSelect: again, reselect: true }} testid="again" />
        <Row title="Other" radio={{ checked: false, onSelect: quiet }} testid="other" />
      </ListGroup>,
    )
    fireEvent.click(screen.getByTestId('quiet'))
    expect(quiet).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('again'))
    expect(again).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('other'))
    expect(quiet).toHaveBeenCalledTimes(1)
  })

  it('a long word in a title gets break points and is still the same text and the same name', () => {
    render(<Row title="Troubleshooting" onPress={() => {}} testid="row" />)
    const row = screen.getByTestId('row')
    expect(row.textContent).toBe('Troubleshooting')
    expect(row.querySelectorAll('.m-shy').length).toBe(3)
    for (const mark of row.querySelectorAll('.m-shy')) {
      expect(mark.getAttribute('aria-hidden')).toBe('true')
      expect(mark.textContent).toBe('')
    }
    expect(screen.getByRole('button', { name: 'Troubleshooting' })).toBe(row)
    cleanup()
    render(<Row title="Appearance" onPress={() => {}} testid="row" />)
    expect(screen.getByTestId('row').querySelectorAll('.m-shy').length).toBe(0)
  })
})

describe('Banner', () => {
  it('draws up to two buttons, each with its own test id', () => {
    const open = vi.fn()
    const dismiss = vi.fn()
    render(
      <Banner testid="banner" actions={[{ label: 'Open chat', onPress: open, testid: 'open' }, { label: 'Dismiss', onPress: dismiss, testid: 'dismiss' }]}>
        LU was closed while answering.
      </Banner>,
    )
    expect(screen.getByTestId('banner').querySelectorAll('button').length).toBe(2)
    fireEvent.click(screen.getByTestId('open'))
    fireEvent.click(screen.getByTestId('dismiss'))
    expect(open).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('the single action of before still works and takes a test id', () => {
    const load = vi.fn()
    render(<Banner action={{ label: 'Load again', onPress: load, testid: 'load' }}>The model was unloaded.</Banner>)
    fireEvent.click(screen.getByTestId('load'))
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Load again' })).toBeTruthy()
  })
})

describe('Fold', () => {
  it('opens and closes, builds its body only while open and names it by the title', () => {
    const body = vi.fn(() => <span>inside</span>)
    render(
      <Fold title="Thought" meta="4 s" state="done" testid="fold">
        {body}
      </Fold>,
    )
    const head = screen.getByTestId('fold')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(body).not.toHaveBeenCalled()
    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Thought' }).textContent).toBe('inside')
    expect(head.closest('.m-fold')?.getAttribute('data-state')).toBe('done')
    fireEvent.click(head)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('can be held from outside', () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <Fold title="Details" open={false} onToggle={onToggle} testid="fold">
        <span>inside</span>
      </Fold>,
    )
    fireEvent.click(screen.getByTestId('fold'))
    expect(onToggle).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('region')).toBeNull()
    rerender(
      <Fold title="Details" open onToggle={onToggle} testid="fold">
        <span>inside</span>
      </Fold>,
    )
    expect(screen.getByRole('region').textContent).toBe('inside')
  })
})

describe('PermissionRow', () => {
  it('shows the three levels and reports a change with the value of the logic', () => {
    const onChange = vi.fn()
    render(<PermissionRow title="Web" hint="Search and read pages." note="Changed for this chat." value="confirm" onChange={onChange} testid="m-perm-web" />)
    expect(screen.getByTestId('m-perm-web-row').textContent).toContain('Search and read pages. Changed for this chat.')
    expect(screen.getByRole('radiogroup', { name: 'Permission for Web' })).toBe(screen.getByTestId('m-perm-web'))
    expect(screen.getByTestId('m-perm-web-confirm').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('m-perm-web-auto'))
    expect(onChange).toHaveBeenCalledWith('auto')
  })
})

describe('NumberField', () => {
  it('with a visible title the title names the field, and whole numbers are rounded and held in range', () => {
    const onChange = vi.fn()
    render(<NumberField label="Keep at most" hint="Whole numbers." showLabel integer value={20} onChange={onChange} min={1} max={200} testid="n" />)
    const input = screen.getByLabelText('Keep at most') as HTMLInputElement
    expect(input).toBe(screen.getByTestId('n'))
    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(screen.getByText('Whole numbers.')).toBeTruthy()
    fireEvent.change(input, { target: { value: '7.6' } })
    expect(onChange).toHaveBeenLastCalledWith(8)
    fireEvent.change(input, { target: { value: '999' } })
    expect(onChange).toHaveBeenLastCalledWith(200)
  })

  it('can be emptied while typing without changing the value', () => {
    const onChange = vi.fn()
    render(<NumberField label="Threads" value={4} onChange={onChange} min={1} max={8} testid="n" />)
    const input = screen.getByTestId('n') as HTMLInputElement
    expect(input.getAttribute('aria-label')).toBe('Threads')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('')
    fireEvent.blur(input)
    expect(input.value).toBe('4')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Threads' }))
    expect(onChange).toHaveBeenLastCalledWith(5)
  })
})

describe('SecretField', () => {
  it('a password can be shown and hidden, and never gets capitals or correction', () => {
    render(<SecretField label="Password" value="secret" onChange={() => {}} autoComplete="current-password" testid="p" actionTestid="show" />)
    const input = screen.getByTestId('p') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByTestId('show'))
    expect(input.type).toBe('text')
    expect(input.getAttribute('autocapitalize')).toBe('none')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy()
  })

  it('a key is never shown: no Show, and Paste only while the field is empty', () => {
    const { rerender } = render(<SecretField label="Token" kind="key" value="" onChange={() => {}} autoComplete="off" testid="k" actionTestid="paste" />)
    expect((screen.getByTestId('k') as HTMLInputElement).type).toBe('password')
    expect(screen.getByTestId('paste').textContent).toBe('Paste')
    rerender(<SecretField label="Token" kind="key" value="hf_abc" onChange={() => {}} autoComplete="off" testid="k" actionTestid="paste" />)
    expect(screen.queryByTestId('paste')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect((screen.getByTestId('k') as HTMLInputElement).type).toBe('password')
  })
})

describe('MiddleEllipsis', () => {
  it('keeps the whole name as its text', () => {
    render(<MiddleEllipsis text="beach-holiday-lisbon.png" testid="m" />)
    expect(screen.getByTestId('m').textContent).toBe('beach-holiday-lisbon.png')
    expect(screen.getByTestId('m').querySelector('.m-mid-tail')?.textContent).toBe('bon.png')
  })
})

describe('ids of Back and Close in the tree', () => {
  const pageEntry: PageEntry = { kind: 'page', route: '/dev/ui', params: {}, key: 'p#1' } as PageEntry
  const sheetEntry: SheetEntry = { kind: 'sheet', sheet: 'dev-demo', props: undefined, sub: [], key: 's#1' } as SheetEntry

  it('the page on top has m-page-back, the page below and the one leaving have their own', () => {
    render(
      <>
        <PageContext.Provider value={{ entry: pageEntry, isTop: true, isRoot: false, place: 'top' }}>
          <Page title="Top" />
        </PageContext.Provider>
        <PageContext.Provider value={{ entry: { ...pageEntry, key: 'p#2' }, isTop: false, isRoot: false, place: 'under' }}>
          <Page title="Under" />
        </PageContext.Provider>
        <PageContext.Provider value={{ entry: { ...pageEntry, key: 'p#3' }, isTop: false, isRoot: false, place: 'leaving' }}>
          <Page title="Leaving" />
        </PageContext.Provider>
      </>,
    )
    expect(screen.getAllByTestId('m-page-back').length).toBe(1)
    expect(screen.getByTestId('m-page-back').closest('section')?.getAttribute('aria-label')).toBe('Top')
    expect(screen.getByTestId('m-page-back-under').closest('section')?.getAttribute('aria-label')).toBe('Under')
    expect(screen.getByTestId('m-page-back-leaving').closest('section')?.getAttribute('aria-label')).toBe('Leaving')
  })

  it('a page outside the stack keeps the bare id', () => {
    render(<Page title="Alone" />)
    expect(screen.getByTestId('m-page-back')).toBeTruthy()
  })

  it('the top sheet has m-sheet-close, m-sheet-back and m-sheet-scrim, a sheet below says how far below', () => {
    render(
      <>
        <SheetContext.Provider value={{ entry: { ...sheetEntry, sub: ['details'] }, isTop: false, locked: false, title: 'Lower', depth: 1 }}>
          <Sheet title="Lower" />
        </SheetContext.Provider>
        <SheetContext.Provider value={{ entry: { ...sheetEntry, key: 's#2', sub: ['details'] }, isTop: true, locked: false, title: 'Upper', depth: 0 }}>
          <Sheet title="Upper" />
        </SheetContext.Provider>
      </>,
    )
    for (const id of ['m-sheet-close', 'm-sheet-back', 'm-sheet-scrim']) {
      expect(screen.getAllByTestId(id).length, id).toBe(1)
      expect(screen.getAllByTestId(`${id}-under-1`).length, id).toBe(1)
    }
    expect(screen.getByTestId('m-sheet-close').closest('[role="dialog"]')?.textContent).toContain('Upper')
    expect(screen.getByTestId('m-sheet-close-under-1').closest('[role="dialog"]')?.textContent).toContain('Lower')
  })
})

describe('the paste button of a field ends honestly (acceptance android-knoepfe, H1)', () => {
  it('says what a read of the clipboard means', async () => {
    const { pasteOutcome } = await import('../paste')
    expect(pasteOutcome('hf_abc')).toBe('pasted')
    expect(pasteOutcome('   ')).toBe('empty')
    expect(pasteOutcome('')).toBe('empty')
    expect(pasteOutcome(null)).toBe('blocked')
  })

  it('a clipboard that cannot be read ends in a sentence with the next step, and the cursor is in the field', async () => {
    const { pasteInto } = await import('../paste')
    const { useToastStore } = await import('../Toast')
    const { COMMON } = await import('../../strings/common')
    // jsdom has no clipboard to read: exactly what the WebView of the phone answered.
    const field = document.createElement('input')
    document.body.appendChild(field)
    const changes: string[] = []
    const outcome = await pasteInto((v) => changes.push(v), field)
    expect(outcome).toBe('blocked')
    expect(changes).toEqual([])
    expect(document.activeElement).toBe(field)
    expect(useToastStore.getState().current?.text).toBe(COMMON.pasteBlocked)
    expect(COMMON.pasteBlocked).toMatch(/Press and hold the field/)
    field.remove()
  })

  it('text on the clipboard lands in the field, trimmed', async () => {
    const { pasteInto } = await import('../paste')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => '  hf_token  ' } })
    const changes: string[] = []
    expect(await pasteInto((v) => changes.push(v))).toBe('pasted')
    expect(changes).toEqual(['hf_token'])
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('asks the native layer first, and falls back to the way before when the command is not there', async () => {
    const { readForPaste, pasteInto } = await import('../paste')
    const web = vi.fn(async () => 'from the web')
    // The command is there and has text: the web is not asked.
    expect(await readForPaste({ native: async () => ' hf_native ', web })).toEqual({ status: 'text', text: ' hf_native ' })
    expect(web).not.toHaveBeenCalled()
    // The command is there and the clipboard is empty: that is the answer, the web is not asked.
    expect(await readForPaste({ native: async () => null, web })).toEqual({ status: 'empty' })
    expect(web).not.toHaveBeenCalled()
    // No such command (an older app, a browser): the way before.
    expect(await readForPaste({ native: async () => undefined, web })).toEqual({ status: 'text', text: 'from the web' })
    // The command broke: the way before.
    expect(
      await readForPaste({
        native: async () => {
          throw new Error('plugin gone')
        },
        web: async () => null,
      }),
    ).toEqual({ status: 'unavailable' })
    // platform/clipboard.readClipboard() wins when it exists, and nothing else is asked.
    const native = vi.fn(async () => 'x')
    expect(await readForPaste({ full: async () => ({ status: 'empty' }), native, web })).toEqual({ status: 'empty' })
    expect(native).not.toHaveBeenCalled()
    const changes: string[] = []
    expect(await pasteInto((v) => changes.push(v), null, { native: async () => ' hf_native ', web })).toBe('pasted')
    expect(changes).toEqual(['hf_native'])
  })

  it('an empty clipboard says so once', async () => {
    const { pasteInto } = await import('../paste')
    const { useToastStore } = await import('../Toast')
    const { COMMON } = await import('../../strings/common')
    expect(await pasteInto(() => {}, null, { native: async () => null, web: async () => null })).toBe('empty')
    expect(useToastStore.getState().current?.text).toBe(COMMON.pasteEmpty)
  })
})

// Check Android package 11, F9b: a tap 50 to 100 ms after a swipe in the chat options opened the row under the one
// aimed at (3 of 9). A tap into content that is still moving is dropped; a tap on content at rest is not.
describe('a sheet drops taps into coasting content', () => {
  const sheetEntry: SheetEntry = { kind: 'sheet', sheet: 'chat-options', props: undefined, sub: [], key: 's#9' } as SheetEntry
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const mount = () => {
    const opened: string[] = []
    render(
      <SheetContext.Provider value={{ entry: sheetEntry, isTop: true, locked: false, title: 'Chat options', depth: 0 }}>
        <Sheet title="Chat options">
          <Row title="Workflows" onPress={() => opened.push('workflows')} testid="row-workflows" />
          <Row title="Sampling" onPress={() => opened.push('sampling')} testid="row-sampling" />
          <Row title="Context window" onPress={() => opened.push('context')} testid="row-context" />
        </Sheet>
      </SheetContext.Provider>,
    )
    const body = document.querySelector('.m-sheet-body') as HTMLElement
    return { opened, body }
  }
  const tap = (el: HTMLElement) => {
    fireEvent.pointerDown(el)
    fireEvent.click(el, { detail: 1 })
  }
  /** A finger that the browser takes over for scrolling, then the content moves. */
  const swipe = (body: HTMLElement) => {
    fireEvent.pointerDown(body)
    fireEvent.pointerCancel(body)
    fireEvent.scroll(body)
  }

  it('a tap while the list still coasts after a swipe opens nothing', async () => {
    const { opened, body } = mount()
    swipe(body)
    tap(screen.getByTestId('row-context'))
    expect(opened).toEqual([])
  })

  it('a tap whose list moved between finger down and click, after a swipe, opens nothing', async () => {
    const { opened, body } = mount()
    swipe(body)
    await sleep(80)
    fireEvent.pointerDown(screen.getByTestId('row-context'))
    body.scrollTop = 40
    fireEvent.click(screen.getByTestId('row-context'), { detail: 1 })
    expect(opened).toEqual([])
  })

  it('a tap on a list at rest opens its row, also shortly after a swipe that has ended', async () => {
    const { opened, body } = mount()
    tap(screen.getByTestId('row-sampling'))
    swipe(body)
    await sleep(100)
    tap(screen.getByTestId('row-context'))
    expect(opened).toEqual(['sampling', 'context'])
  })

  it('a scroll the app makes itself (a row brought into view) does not drop the tap that follows', () => {
    const { opened, body } = mount()
    fireEvent.scroll(body)
    body.scrollTop = 40
    fireEvent.scroll(body)
    tap(screen.getByTestId('row-sampling'))
    expect(opened).toEqual(['sampling'])
  })

  it('Close works while the list coasts: the header does not move with it', async () => {
    const { navApi } = await import('../../nav/api')
    const close = vi.spyOn(navApi, 'closeSheet').mockImplementation(() => {})
    const { body } = mount()
    swipe(body)
    tap(screen.getByTestId('m-sheet-close'))
    expect(close).toHaveBeenCalledTimes(1)
    close.mockRestore()
  })

  it('a click without a finger (keyboard) is never dropped', async () => {
    const { opened, body } = mount()
    swipe(body)
    fireEvent.click(screen.getByTestId('row-sampling'), { detail: 0 })
    expect(opened).toEqual(['sampling'])
  })
})

// Round 57: lists of things are flat, a quiet offer is a link. Both stay real targets with their names.
describe('flat list and link', () => {
  it('a flat group draws no card around its rows and keeps the hairline rows and their targets', () => {
    render(
      <>
        <ListGroup title="Recent desktops" flat testid="flat">
          <Row title="studio-pc" onPress={() => {}} testid="desk" />
        </ListGroup>
        <ListGroup title="General" testid="card">
          <Row title="Appearance" onPress={() => {}} />
        </ListGroup>
      </>,
    )
    const flat = screen.getByTestId('flat')
    expect(flat.querySelector('.m-group')?.classList.contains('m-group--flat')).toBe(true)
    expect(flat.querySelector('.m-group-label')?.classList.contains('m-group-label--flat')).toBe(true)
    expect(screen.getByTestId('desk').tagName).toBe('BUTTON')
    expect(screen.getByTestId('card').querySelector('.m-group--flat')).toBeNull()
  })

  it('a link button is a button with its words as its name', () => {
    const go = vi.fn()
    render(
      <Button variant="link" onPress={go} testid="link">
        Restore from backup
      </Button>,
    )
    const link = screen.getByTestId('link')
    expect(link.tagName).toBe('BUTTON')
    expect(link.classList.contains('m-btn--link')).toBe(true)
    expect(link.textContent).toBe('Restore from backup')
    fireEvent.click(link)
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('round 57: Segmented as tabs', () => {
  const options = [
    { value: 'a', label: 'On this phone', testid: 'seg-a' },
    { value: 'b', label: 'Remote desktop', testid: 'seg-b' },
  ] as const
  it('the default keeps the box, look="tabs" drops it and keeps the radio group', () => {
    render(<Segmented label="Where" options={options} value="a" onChange={() => {}} testid="seg-box" />)
    expect(screen.getByTestId('seg-box').className).toBe('m-seg')
    cleanup()
    const change = vi.fn()
    render(<Segmented label="Where" look="tabs" options={options} value="a" onChange={change} testid="seg-tabs" />)
    const group = screen.getByTestId('seg-tabs')
    expect(group.className).toBe('m-seg m-seg--tabs')
    expect(group.getAttribute('role')).toBe('radiogroup')
    expect(screen.getByTestId('seg-a').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('seg-b'))
    expect(change).toHaveBeenCalledWith('b')
  })
})
