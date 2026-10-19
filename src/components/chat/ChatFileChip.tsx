import { File as FileIcon, X } from 'lucide-react'
import type { FileAttachment } from '../../types/chat'
import { formatBytes } from '../../lib/formatters'
import { chipCutLabel } from '../../lib/chat-file-fit'

/**
 * One attached file as a chip: name, the type read from its bytes, its size.
 *
 * The same chip stands in the composer (with the x) and in the transcript
 * (without it). It shows a description, never the file: the bytes are not in
 * the chat (lib/chat-files.ts), so there is nothing here to open or save.
 */
export function ChatFileChip({ file, onRemove, testId = 'chat-file-chip' }: {
  file: FileAttachment
  /** Composer only: take the file off the draft again. */
  onRemove?: () => void
  testId?: string
}) {
  const where = file.workspacePath ? `\nIn the working folder: ${file.workspacePath}` : ''
  // GH #171: a text that went out shorter says so on the chip, for as long as
  // the message is there, not only in the line that showed at send time.
  const cut = chipCutLabel(file)
  return (
    <div
      data-testid={testId}
      title={`${file.name}\n${file.kind}, ${formatBytes(file.size)}${cut ? `\nOnly part of the text reached the model: ${cut}` : ''}\nSHA-256 ${file.sha256}${where}`}
      className="flex items-center gap-1.5 max-w-[240px] pl-2 pr-1.5 py-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-left"
    >
      <FileIcon size={13} className="shrink-0 text-gray-400" />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="truncate t-mono text-gray-800 dark:text-gray-200">{file.name}</span>
        <span className="truncate t-micro text-gray-500 dark:text-gray-400">{file.kind}, {formatBytes(file.size)}</span>
        {cut && <span data-testid="chat-file-cut" className="truncate t-micro text-gray-500 dark:text-gray-400">{cut}</span>}
      </span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
        >
          <X size={9} />
        </button>
      )}
    </div>
  )
}
