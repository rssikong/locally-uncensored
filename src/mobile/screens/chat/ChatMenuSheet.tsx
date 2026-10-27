/**
 * C7 Chat menu. Sheet "chat-menu", strand 1 (Chat core).
 *
 * Opened with nav.openSheet('chat-menu', { chatId }) from "More" at a row of
 * the list (C1.5) and from "Chat menu" in the header of a chat (C2.2).
 * Sub pages: "export" (Markdown or JSON, then the share sheet of the system)
 * and "files" (every image, file and artifact of the chat).
 */
import { useState } from 'react'
import { Braces, FileDown, FileText, Files, FolderOpen, GitCompareArrows, Image as ImageIcon, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { formatBytes } from '../../../lib/formatters'
import { subAgentsOffered } from '../../../lib/phone-sub-agents'
import { useAgentTaskStore } from '../../../stores/agentTaskStore'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { useRAGStore } from '../../../stores/ragStore'
import { nav, useSheet } from '../../nav'
import { CHAT_STRINGS } from '../../strings/chat'
import { Banner, EmptyState, ListGroup, Notice, Row, Sheet, Spinner, toast } from '../../ui'
import { exportChat, saveChat, saveNote, type SaveNote } from './parts/adapters/handover'
import './parts/chat.css'
import { chatTitle, chatTitleShown } from './parts/logic/chat-list'
import { useDraftStore } from './parts/logic/drafts'
import { chatFiles, encodeFileRef, visibleMessages } from './parts/logic/messages'
import { WORKSPACE_LIST_MAX, useWorkspaceFiles } from './parts/workspace-files'

const S = CHAT_STRINGS.menu

/** Is the page under the sheet the chat with this id? Then deleting it must also leave the page. */
function chatPageIsOpen(chatId: string): boolean {
  const state = nav.getState()
  const stack = state.flow ? state.flowStack : state.stacks[state.tab]
  const top = stack[stack.length - 1]
  return !!top && top.route.startsWith('/chat/:id') && top.params.id === chatId
}

export default function ChatMenuSheet() {
  const sheet = useSheet<{ chatId?: string | null } | undefined>()
  const chatId = sheet.props?.chatId ?? null
  const conversation = useChatStore((s) => (chatId ? s.conversations.find((c) => c.id === chatId) : undefined))
  const documents = useRAGStore((s) => (chatId ? (s.documents[chatId]?.length ?? 0) : 0))
  const tasks = useAgentTaskStore((s) => (chatId ? (s.byConv[chatId] ?? []) : []).filter((t) => t.status === 'running' || t.status === 'queued').length)
  // A model of this phone starts no sub agents (lib/phone-sub-agents.ts). The row stays for a chat that already has tasks from a cloud model.
  const everHadTasks = useAgentTaskStore((s) => (chatId ? (s.byConv[chatId] ?? []) : []).length > 0)
  const showTasks = useModelStore((s) => subAgentsOffered(s.activeModel)) || everHadTasks
  const [exporting, setExporting] = useState<'markdown' | 'json' | null>(null)
  // What "Save to this phone" came to. It stays on the sheet, so the user reads where the file is.
  const [saved, setSaved] = useState<SaveNote | null>(null)
  // What the agent wrote into the folder of this chat belongs to "Files in this chat" as well (audit L4).
  const folder = useWorkspaceFiles(chatId)

  if (!chatId || !conversation) {
    return (
      <Sheet title={S.title}>
        <Notice variant="info" testid="m-chat-menu-empty">
          {chatId ? S.gone : S.notSaved}
        </Notice>
      </Sheet>
    )
  }

  const files = chatFiles(conversation)
  const hasMessages = visibleMessages(conversation.messages).length > 0

  if (sheet.sub === 'export') {
    const run = (format: 'markdown' | 'json') => {
      if (exporting) return
      setExporting(format)
      void exportChat(conversation, format)
        .then((result) => {
          if (result === 'done') {
            toast(S.exportReady, { testid: 'export-ready' })
            sheet.close()
          } else if (result === 'failed') {
            toast(S.exportFailed, { tone: 'error', testid: 'export-failed' })
          }
        })
        .finally(() => setExporting(null))
    }
    const save = (format: 'markdown' | 'json') => {
      if (exporting) return
      setExporting(format)
      setSaved(null)
      void saveChat(conversation, format)
        .then(({ outcome, name }) => {
          const note = saveNote(outcome, name)
          setSaved(note)
          if (note.ok) toast(CHAT_STRINGS.save.savedToast, { testid: 'export-saved' })
        })
        .finally(() => setExporting(null))
    }
    return (
      <Sheet title={S.exportTitle}>
        {hasMessages ? (
          <>
            <ListGroup title={CHAT_STRINGS.save.shareGroup}>
              <Row title={S.markdown} subtitle={S.markdownSub} icon={FileText} chevron={false} disabled={exporting !== null} onPress={() => run('markdown')} risk="leaves-app" testid="m-chat-menu-export-markdown" el="C7.2" />
              <Row title={S.json} subtitle={S.jsonSub} icon={Braces} chevron={false} disabled={exporting !== null} onPress={() => run('json')} risk="leaves-app" testid="m-chat-menu-export-json" el="C7.2" />
            </ListGroup>
            <ListGroup title={CHAT_STRINGS.save.saveGroup}>
              <Row title={S.markdown} subtitle={CHAT_STRINGS.save.saveSub} icon={FileText} chevron={false} disabled={exporting !== null} onPress={() => save('markdown')} testid="m-chat-menu-save-markdown" el="C7.2" />
              <Row title={S.json} subtitle={CHAT_STRINGS.save.saveSub} icon={Braces} chevron={false} disabled={exporting !== null} onPress={() => save('json')} testid="m-chat-menu-save-json" el="C7.2" />
            </ListGroup>
            {saved ? (
              <Notice variant={saved.tone} testid="m-chat-menu-save-note">
                {saved.text}
              </Notice>
            ) : null}
          </>
        ) : (
          <Notice variant="info" testid="m-chat-menu-export-empty">
            {S.exportEmpty}
          </Notice>
        )}
      </Sheet>
    )
  }

  const folderFiles = folder.list.state === 'ready' ? folder.list.files : []
  const fileCount = files.length + folderFiles.length

  if (sheet.sub === 'files') {
    const nothing = files.length === 0 && folder.list.state === 'ready' && folderFiles.length === 0
    return (
      <Sheet title={S.filesTitle}>
        {nothing ? (
          <EmptyState title={S.filesEmpty} icon={FolderOpen} testid="m-chat-menu-files-empty">
            {S.filesEmptyText}
          </EmptyState>
        ) : null}
        {files.length > 0 ? (
          <ListGroup title={S.chatGroup}>
            {files.map((file) => (
              <Row
                key={file.fileId}
                id={file.fileId}
                title={file.name}
                icon={file.kind === 'image' ? ImageIcon : FileText}
                subtitle={[file.from === 'answer' ? S.fromAnswer : S.fromYou, file.size ? formatBytes(file.size) : null].filter(Boolean).join(', ')}
                onPress={() => nav.push('/chat/:id/file/:fileId', { id: chatId, fileId: file.fileId })}
                testid="m-chat-menu-file"
                el="C7.6"
              />
            ))}
          </ListGroup>
        ) : null}
        {folder.list.state === 'loading' ? (
          <div className="m-chat-status" role="status" data-testid="m-chat-menu-folder-loading">
            <Spinner label={S.folderLoading} />
            <span>{S.folderLoading}</span>
          </div>
        ) : null}
        {folder.list.state === 'failed' ? (
          <Banner variant="warn" testid="m-chat-menu-folder-failed" action={{ label: S.folderRetry, onPress: folder.reload }}>
            {S.folderFailed}
          </Banner>
        ) : null}
        {folderFiles.length > 0 ? (
          <ListGroup title={S.folderGroup}>
            {folderFiles.map((file) => (
              <Row
                key={file.path}
                id={file.path}
                title={file.path}
                icon={/\.(png|jpe?g|gif|webp)$/i.test(file.name) ? ImageIcon : FileText}
                subtitle={[S.fromAgent, file.size ? formatBytes(file.size) : null].filter(Boolean).join(', ')}
                onPress={() => nav.push('/chat/:id/file/:fileId', { id: chatId, fileId: encodeFileRef({ kind: 'workspace', path: file.path }) })}
                testid="m-chat-menu-wsfile"
                el="C7.6"
              />
            ))}
          </ListGroup>
        ) : null}
        {folder.list.state === 'ready' && folder.list.cut ? (
          <Notice variant="info" testid="m-chat-menu-folder-cut">
            {S.folderCut(WORKSPACE_LIST_MAX)}
          </Notice>
        ) : null}
      </Sheet>
    )
  }

  const rename = () => {
    void nav.prompt({ title: S.renameTitle, confirmLabel: S.save, field: { label: S.renameField, initial: chatTitle(conversation) }, testid: 'rename' }).then((name) => {
      if (name === null) return
      const next = name.trim()
      if (!next) return
      useChatStore.getState().renameConversation(chatId, next)
      nav.closeSheet()
      toast(S.renamed, { testid: 'renamed' })
    })
  }

  const remove = () => {
    void nav.confirm({ title: S.deleteTitle, text: S.deleteText, confirmLabel: S.deleteConfirm, tone: 'danger', testid: 'delete-chat' }).then((yes) => {
      if (!yes) return
      const leavePage = chatPageIsOpen(chatId)
      nav.closeSheet()
      if (leavePage) nav.back()
      useChatStore.getState().deleteConversation(chatId)
      useDraftStore.getState().clear(chatId)
      toast(S.deleted, { testid: 'chat-deleted' })
    })
  }

  return (
    <Sheet title={chatTitleShown(conversation)}>
      <ListGroup>
        <Row title={S.rename} icon={Pencil} chevron={false} onPress={rename} testid="m-chat-menu-rename" el="C7.1" />
        <Row title={S.export} subtitle={S.exportSub} icon={FileDown} onPress={() => sheet.pushSub('export')} testid="m-chat-menu-export" el="C7.2" />
        <Row title={S.compare} icon={GitCompareArrows} onPress={() => nav.push('/chat/:id/compare', { id: chatId })} testid="m-chat-menu-compare" el="C7.3" />
        {showTasks ? <Row title={S.tasks} subtitle={S.tasksSub(tasks)} icon={ListChecks} onPress={() => nav.push('/chat/:id/tasks', { id: chatId })} testid="m-chat-menu-tasks" el="C7.4" /> : null}
        <Row title={S.documents} subtitle={S.documentsSub(documents)} icon={Files} onPress={() => nav.push('/chat/:id/documents', { id: chatId })} testid="m-chat-menu-documents" el="C7.5" />
        <Row title={S.files} subtitle={S.filesSub(fileCount)} icon={FolderOpen} onPress={() => sheet.pushSub('files')} testid="m-chat-menu-files" el="C7.6" />
      </ListGroup>
      <ListGroup>
        <Row title={S.deleteChat} icon={Trash2} danger chevron={false} risk="destructive" onPress={remove} testid="m-chat-menu-delete" el="C7.7" />
      </ListGroup>
    </Sheet>
  )
}
