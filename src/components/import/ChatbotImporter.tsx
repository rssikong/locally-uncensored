// Feature CC v2.5.0, chatbot export importer (MikeS++ Discord 2026-05-27).
// D26 (3.0.8): the user picks an export file (.zip or conversations.json),
// sees what is in it, picks all or some conversations, and every picked
// conversation becomes its own chat in the normal chat store. The 2.5.0 path
// (each conversation as a document in the open chat's RAG store) stays as
// the second button for whoever wants the history searchable from one chat.
//
// Large exports: the parse runs in a worker (chatbot-export-offthread.ts)
// and the chats go into the store in batches (lib/chat-import.ts), both with
// progress on screen.

import { useMemo, useState } from 'react'
import { Upload, FileText, CheckCircle2, AlertTriangle, Loader2, MessagesSquare } from 'lucide-react'
import { Hinweis } from '../ui/Hinweis'
import { conversationToFile, type NormalisedConversation, type ParseProgress } from '../../lib/parsers/chatbot-export'
import { parseExportFileOffThread } from '../../lib/parsers/chatbot-export-offthread'
import { importAsChats, importState, type ImportState, type ImportProgress, type ImportAsChatsResult } from '../../lib/chat-import'
import { useRAG } from '../../hooks/useRAG'
import { useChatStore, flushChatPersist } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { countLabel, formatCount } from '../../lib/formatters'

/** Rows drawn at once; a 5000-conversation export would otherwise draw 5000. */
const PAGE = 200

function parseProgressText(p: ParseProgress | null): string {
  if (!p) return 'Reading export…'
  if (p.stage === 'reading') return p.total > 1 ? `Reading file ${Math.min(p.done + 1, p.total)} of ${p.total}…` : 'Reading export…'
  return `Reading conversations: ${formatCount(p.done)} of ${formatCount(p.total)}`
}

export function ChatbotImporter() {
  const conversationId = useChatStore(s => s.activeConversationId)
  const storedChats = useChatStore(s => s.conversations)
  // useRAG takes `string | null` and already handles the null case.
  const rag = useRAG(conversationId)
  const uploadDocument = rag.uploadDocument

  const [conversations, setConversations] = useState<NormalisedConversation[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<ParseProgress | null>(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [chatResult, setChatResult] = useState<ImportAsChatsResult | null>(null)
  const [ragDone, setRagDone] = useState(0)

  const existing = useMemo(() => new Map(storedChats.map(c => [c.id, c])), [storedChats])
  const states = useMemo(() => {
    const m = new Map<string, ImportState>()
    for (const c of conversations) m.set(c.id, importState(c, existing))
    return m
  }, [conversations, existing])
  const presentCount = useMemo(() => [...states.values()].filter(s => s === 'present').length, [states])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? conversations.filter(c => c.title.toLowerCase().includes(q)) : conversations
  }, [conversations, filter])

  const busy = parsing || importing

  const handleFile = async (file: File) => {
    setParsing(true)
    setParseProgress(null)
    setError(null)
    setConversations([])
    setSelected(new Set())
    setChatResult(null)
    setRagDone(0)
    setFilter('')
    setLimit(PAGE)
    try {
      const result = await parseExportFileOffThread(file, setParseProgress)
      setConversations(result.conversations)
      setSkipped(result.skipped)
      // Pre-select what is not in LU yet (or has changed since); the user can
      // narrow it down before importing.
      setSelected(new Set(result.conversations.filter(c => importState(c, existing) !== 'present').map(c => c.id)))
      if (result.conversations.length === 0) {
        setError('No conversations found in this file. Choose the .zip from the ChatGPT export, or the conversations.json inside it.')
      }
    } catch (e) {
      setError(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setParsing(false)
      setParseProgress(null)
    }
  }

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    // Clear the input so choosing the same file again fires a change.
    e.target.value = ''
    if (f) void handleFile(f)
  }

  const toggleSelection = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // With a filter typed in, Select all / none act on the matches only.
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const c of filtered) {
        if (allFilteredSelected) next.delete(c.id); else next.add(c.id)
      }
      return next
    })
  }

  const handleImportChats = async () => {
    const toImport = conversations.filter(c => selected.has(c.id))
    if (toImport.length === 0) return
    setImporting(true)
    setError(null)
    setChatResult(null)
    setRagDone(0)
    try {
      const result = await importAsChats(toImport, {
        model: useModelStore.getState().activeModel ?? '',
        getConversations: () => useChatStore.getState().conversations,
        importConversations: useChatStore.getState().importConversations,
        onProgress: setImportProgress,
      })
      // Write the history now instead of at the next coalescing window, so
      // closing the app right after the import does not lose it.
      await flushChatPersist()
      setChatResult(result)
      setSelected(new Set())
    } catch (e) {
      setError(`Import stopped: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }

  // The 2.5.0 path: each picked conversation as a document in the open chat.
  const handleImportDocuments = async () => {
    if (!conversationId) return
    const toImport = conversations.filter(c => selected.has(c.id))
    if (toImport.length === 0) return
    setImporting(true)
    setImportProgress({ done: 0, total: toImport.length })
    setError(null)
    setChatResult(null)
    setRagDone(0)
    let done = 0
    const failed: string[] = []
    for (const conv of toImport) {
      try {
        await uploadDocument(conversationToFile(conv))
        done++
      } catch (e) {
        failed.push(`${conv.title}: ${e instanceof Error ? e.message : String(e)}`)
      }
      setImportProgress({ done: done + failed.length, total: toImport.length })
      setRagDone(done)
    }
    setImporting(false)
    setImportProgress(null)
    if (failed.length > 0) {
      setError(`${done} added, ${failed.length} failed:\n${failed.slice(0, 5).join('\n')}${failed.length > 5 ? `\n…and ${failed.length - 5} more` : ''}`)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 p-2.5 rounded-lg border border-blue-200 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/[0.08] text-blue-900 dark:text-blue-200">
        <MessagesSquare size={14} className="mt-0.5 shrink-0" />
        <div className="t-micro leading-relaxed">
          <strong>Bring your chat history over.</strong> Choose a ChatGPT export and every conversation becomes its own chat here, with its title, its date and its messages. Images and files from the export are not copied; a short note marks where they were. Everything stays on this machine.
        </div>
      </div>

      <div>
        <label className="block cursor-pointer">
          <input
            type="file"
            accept=".json,.zip,application/json,application/zip"
            onChange={onFileInput}
            disabled={busy}
            className="sr-only"
          />
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-[0.7rem] ${
            busy
              ? 'border-white/8 text-gray-500 cursor-not-allowed'
              : 'border-white/15 hover:border-white/30 text-gray-300 hover:bg-white/[0.03]'
          }`}>
            {parsing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            <span>{parsing ? parseProgressText(parseProgress) : 'Choose export file (.zip or .json)'}</span>
          </div>
        </label>
        <div className="text-[0.55rem] text-gray-500 mt-1 leading-relaxed">
          In ChatGPT: Settings, Data controls, Export data. The mail that follows links to a .zip; choose that file, or the <code className="font-mono">conversations.json</code> inside it. Exports from other chatbots in the same form work too.
        </div>
      </div>

      {/* Der Fehler stand in einem roten Kasten mit Rahmen und Fuellflaeche.
          Die Farbe traegt hier schon alles, was der Kasten dazutun sollte;
          das Kreuz zum Wegklicken bringt <Hinweis> selbst mit. */}
      {error && (
        <Hinweis
          ton="fehler"
          icon={<AlertTriangle size={12} className="mt-0.5 shrink-0" />}
          onDismiss={() => setError(null)}
          className="whitespace-pre-wrap"
        >
          {error}
        </Hinweis>
      )}

      {conversations.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2 t-micro">
            <span className="text-gray-400">
              {countLabel(conversations.length, 'conversation')} found
              {' · '}
              {formatCount(selected.size)} selected
              {presentCount > 0 ? ` · ${formatCount(presentCount)} already imported` : ''}
              {skipped > 0 ? ` · ${formatCount(skipped)} skipped` : ''}
            </span>
            <button
              onClick={toggleAll}
              className="shrink-0 text-gray-400 hover:text-white disabled:opacity-40"
              disabled={importing || filtered.length === 0}
            >
              {allFilteredSelected ? 'Select none' : 'Select all'}
            </button>
          </div>

          {conversations.length > 10 && (
            <input
              type="search"
              value={filter}
              onChange={e => { setFilter(e.target.value); setLimit(PAGE) }}
              placeholder="Filter by title"
              aria-label="Filter conversations by title"
              disabled={importing}
              className="w-full px-2 py-1 rounded border border-white/10 bg-transparent t-micro text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-white/25"
            />
          )}

          <div className="space-y-1 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
            {filtered.slice(0, limit).map(c => {
              const isOn = selected.has(c.id)
              const state = states.get(c.id) ?? 'new'
              const date = c.createdAt ?? c.updatedAt
              return (
                <label
                  key={c.id}
                  className={`flex items-start gap-2 p-1.5 rounded border ${
                    isOn ? 'border-white/15 bg-white/[0.04]' : 'border-white/5 hover:bg-white/[0.02]'
                  } cursor-pointer`}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggleSelection(c.id)}
                    disabled={importing}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="t-micro text-gray-200 truncate">{c.title}</div>
                    <div className="text-[0.55rem] text-gray-500">
                      {countLabel(c.messageCount, 'message')}
                      {date ? ` · ${new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}` : ''}
                    </div>
                  </div>
                  {state === 'present' && (
                    <span className="shrink-0 t-micro text-gray-500">Already imported</span>
                  )}
                  {state === 'newer' && (
                    <span className="shrink-0 t-micro text-blue-400">Updated since last import</span>
                  )}
                  {state === 'continued' && (
                    <span className="shrink-0 t-micro text-blue-400">Continued in LU, imports as a separate chat</span>
                  )}
                </label>
              )
            })}
            {filtered.length > limit && (
              <button
                onClick={() => setLimit(l => l + PAGE)}
                className="w-full py-1 t-micro text-gray-400 hover:text-white"
              >
                Show {formatCount(Math.min(PAGE, filtered.length - limit))} more ({formatCount(filtered.length - limit)} not shown)
              </button>
            )}
            {filtered.length === 0 && (
              <div className="t-micro text-gray-500 p-1.5">No conversation matches the filter.</div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={() => void handleImportChats()}
              disabled={selected.size === 0 || importing}
              className="px-3 py-1.5 rounded text-[0.7rem] font-medium bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white inline-flex items-center gap-1.5"
            >
              {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {importing && importProgress
                ? `Importing ${formatCount(importProgress.done)} of ${formatCount(importProgress.total)}`
                : `Import ${countLabel(selected.size, 'chat')}`}
            </button>
            <button
              onClick={() => void handleImportDocuments()}
              disabled={selected.size === 0 || importing || !conversationId}
              title={conversationId ? undefined : 'Open a chat first'}
              className="px-2 py-1.5 rounded t-micro text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add to the open chat's documents instead
            </button>
          </div>

          {!importing && chatResult && (
            <div className="t-micro text-green-400 inline-flex items-start gap-1">
              <CheckCircle2 size={10} className="mt-0.5 shrink-0" />
              <span>
                {chatResult.added + chatResult.separate > 0
                  ? `${countLabel(chatResult.added + chatResult.separate, 'chat')} imported. They are in the chat list under their original dates.`
                  : 'Nothing new to import.'}
                {chatResult.separate > 0 ? ` ${countLabel(chatResult.separate, 'chat')} you had continued here ${chatResult.separate === 1 ? 'stays' : 'stay'} as ${chatResult.separate === 1 ? 'it is' : 'they are'}; the newer export ${chatResult.separate === 1 ? 'is a separate chat' : 'came in as separate chats'} ending in "(from export)".` : ''}
                {chatResult.skipped > 0 ? ` ${countLabel(chatResult.skipped, 'chat')} ${chatResult.skipped === 1 ? 'was' : 'were'} already there and stayed as ${chatResult.skipped === 1 ? 'it is' : 'they are'}.` : ''}
              </span>
            </div>
          )}
          {!importing && ragDone > 0 && !error && (
            <span className="t-micro text-green-400 inline-flex items-center gap-1">
              <CheckCircle2 size={10} /> {countLabel(ragDone, 'conversation')} added to the open chat's documents
            </span>
          )}
        </>
      )}
    </div>
  )
}
