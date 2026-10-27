import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Brain, Check, Folder, FolderOpen, Lock, Monitor, Settings2, Shield } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { BetaMark } from '../ui/BetaMark'
import { ModalActions, ModalButton } from '../ui/ModalActions'
import { AgentWorkspaceDialog } from '../chat/AgentWorkspaceDialog'
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape'
import { useVoiceStore } from '../../stores/voiceStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useComputerStore } from '../../stores/computerStore'
import { backendCall, isTauri } from '../../api/backend'
import { canUseTools } from '../../lib/tool-support'
import { isThinkingCompatible } from '../../lib/model-compatibility'
import { voiceThinkingLock } from '../../api/voice-brain'
import type { VoiceWorkScope } from '../../lib/voice/work-scope'
import type { AgentWorkspace } from '../../types/agent-workspace'

/** The honest reason the middle choice cannot be picked. */
export const SANDBOX_REASON = 'Not available yet. LU cannot run commands in an isolated environment, so it does not offer one.'

function folderName(path: string | undefined): string {
  if (!path) return 'folder'
  const cleaned = path.replace(/[\\/]+$/, '')
  return cleaned.split(/[\\/]/).pop() || cleaned
}

/** Where the files of a voice session live, in a few words. */
function workspaceWords(workspace: AgentWorkspace | null): string {
  return workspace?.kind === 'folder' && workspace.path ? folderName(workspace.path) : 'its own folder'
}

interface Props {
  onOpenSettings: () => void
}

/**
 * The switches of the Voice surface, in one row of equal squares next to the
 * title: settings, Agent, where the agent may work, Thinking. Every one of
 * them can be moved while a session runs, and the session follows at once.
 */
export function VoiceControls({ onOpenSettings }: Props) {
  const agent = useVoiceStore((s) => s.loopAgent)
  const scope = useVoiceStore((s) => s.loopScope)
  const picked = useVoiceStore((s) => s.loopWorkspace)
  const confirmed = useVoiceStore((s) => s.loopComputerConfirmed)
  const thinking = useVoiceStore((s) => s.loopThinking)
  const update = useVoiceStore((s) => s.updateVoiceSettings)
  const defaultWorkspace = useSettingsStore((s) => s.settings.defaultWorkspace)
  const activeModel = useModelStore((s) => s.activeModel)
  const meta = useModelStore((s) => s.models.find((m) => m.name === s.activeModel))

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismissOnEscape(menuOpen, closeMenu)

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || menuButton.current?.contains(target)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])
  // The menu opens with the keyboard on its current choice.
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }, [menuOpen])

  // Same question the Agent switch of the chat asks: can this model drive tools.
  const serverTools = meta && 'supportsTools' in meta ? meta.supportsTools : undefined
  const toolsPossible = activeModel ? canUseTools({ name: activeModel, supportsTools: serverTools }) : true
  const agentOn = agent && toolsPossible

  // The Think switch of the chat, with the same words.
  const thinkMode = meta && 'thinkMode' in meta ? meta.thinkMode : undefined
  const lock = voiceThinkingLock({ thinkMode, reasons: isThinkingCompatible(activeModel) })
  const canThink = thinkMode ? thinkMode === 'toggle' : isThinkingCompatible(activeModel)
  const thinkingLocked = lock === 'always' || !canThink
  const thinkingShown = lock === 'always' || (thinking && canThink)
  const thinkingTitle = lock === 'always'
    ? 'Thinking is always on for this model. Voice does not show it and never reads it aloud.'
    : !canThink
      ? 'Model does not support thinking'
      : thinking
        ? 'Thinking ON. The thought is shown, never read aloud. Its length is in the Voice settings.'
        : 'Thinking OFF'

  const workspace = picked ?? defaultWorkspace ?? null
  const where = workspaceWords(workspace)
  const scopeLabel = scope === 'computer' ? 'Whole computer' : 'Workspace only'
  const scopeTitle = !agentOn
    ? 'Where it may work. Switch the agent on first.'
    : scope === 'computer'
      ? 'Where it may work: Whole computer. Files and commands anywhere, and the screen.'
      : `Where it may work: Workspace only. Files stay in ${where}, commands ask first, no screen.`

  const choose = (next: VoiceWorkScope) => {
    setMenuOpen(false)
    menuButton.current?.focus()
    if (next === scope) return
    if (next === 'computer') {
      if (!confirmed) {
        setConfirmOpen(true)
        return
      }
      allowComputer()
      return
    }
    update({ loopScope: 'workspace' })
    // No run stays out of the file jail, and the next "Whole computer" asks again.
    if (isTauri()) void backendCall('fs_whole_computer_forget').catch(() => {})
  }
  const allowComputer = () => {
    update({ loopScope: 'computer', loopComputerConfirmed: true })
    // The screen is part of the whole computer: computer control goes on with it.
    if (!useComputerStore.getState().enabled) useComputerStore.getState().setEnabled(true)
    setConfirmOpen(false)
  }
  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])
    if (items.length === 0) return
    event.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }

  const itemCls = 'w-full flex items-start gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] focus:outline-none focus-visible:bg-gray-100 dark:focus-visible:bg-white/[0.08]'
  const ScopeIcon = scope === 'computer' ? Monitor : Folder

  return (
    <div className="flex items-center gap-1" role="toolbar" aria-label="Voice controls" data-testid="voice-controls">
      <button type="button" className="lu-control lu-control--icon" onClick={onOpenSettings} aria-label="Voice settings" title="Voice settings">
        <Settings2 size={12} />
      </button>

      <button
        type="button"
        className="lu-control lu-control--icon"
        onClick={() => update({ loopAgent: !agent })}
        disabled={!toolsPossible}
        aria-pressed={agentOn}
        aria-label="Agent"
        data-testid="voice-agent"
        title={!toolsPossible
          ? 'Agent is not available: this model cannot use tools.'
          : agent
            ? 'Agent ON. Voice can use tools: the web, files, commands. Click for a conversation with web search only.'
            : 'Agent OFF. Conversation with web search. Click to let Voice also use files and commands.'}
      >
        <Bot size={12} />
      </button>

      <div className="relative">
        <button
          ref={menuButton}
          type="button"
          className="lu-control lu-control--icon"
          onClick={() => setMenuOpen((open) => !open)}
          disabled={!agentOn}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Where it may work: ${scopeLabel}`}
          data-testid="voice-scope"
          data-scope={scope}
          title={scopeTitle}
        >
          <ScopeIcon size={12} />
        </button>
        {menuOpen && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Where it may work"
            onKeyDown={onMenuKey}
            className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg lu-elevated p-1.5"
          >
            <div className="px-2.5 pt-1 pb-1.5 t-micro text-gray-500 dark:text-gray-400">Where it may work</div>
            <button type="button" role="menuitemradio" aria-checked={scope === 'workspace'} className={itemCls} onClick={() => choose('workspace')}>
              <Folder size={13} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="flex-1 min-w-0">
                <span className="block t-control text-gray-900 dark:text-white">Workspace only</span>
                <span className="block t-micro leading-relaxed text-gray-500 dark:text-gray-400">
                  Files stay in <span className="font-mono">{where}</span>. Commands start there and ask every time. No screen.
                </span>
              </span>
              {scope === 'workspace' && <Check size={12} className="mt-0.5 shrink-0 text-gray-700 dark:text-gray-200" />}
            </button>
            <div
              role="menuitemradio"
              aria-checked={false}
              aria-disabled="true"
              title={SANDBOX_REASON}
              data-testid="voice-scope-sandbox"
              className="w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md opacity-60 cursor-not-allowed"
            >
              <Shield size={13} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="flex-1 min-w-0">
                <span className="block t-control text-gray-900 dark:text-white">Sandbox</span>
                <span className="block t-micro leading-relaxed text-gray-500 dark:text-gray-400">{SANDBOX_REASON}</span>
              </span>
              <Lock size={11} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
            </div>
            <button type="button" role="menuitemradio" aria-checked={scope === 'computer'} className={itemCls} onClick={() => choose('computer')}>
              <Monitor size={13} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="flex-1 min-w-0">
                <span className="block t-control text-gray-900 dark:text-white">Whole computer</span>
                <span className="block t-micro leading-relaxed text-gray-500 dark:text-gray-400">
                  Files and commands in any folder your permissions allow, and the screen.
                </span>
              </span>
              {scope === 'computer' && <Check size={12} className="mt-0.5 shrink-0 text-gray-700 dark:text-gray-200" />}
            </button>
            <div className="my-1 border-t border-gray-200 dark:border-white/[0.08]" />
            <button type="button" role="menuitem" className={itemCls} onClick={() => { setMenuOpen(false); setFolderOpen(true) }}>
              <FolderOpen size={13} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
              <span className="flex-1 min-w-0">
                <span className="block t-control text-gray-900 dark:text-white">Choose the workspace folder</span>
                <span className="block t-micro leading-relaxed text-gray-500 dark:text-gray-400 truncate">
                  {workspace?.kind === 'folder' && workspace.path ? workspace.path : 'Now: a folder of its own for every session.'}
                </span>
              </span>
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="lu-control lu-control--icon"
        onClick={() => { if (!thinkingLocked) update({ loopThinking: !thinking }) }}
        disabled={thinkingLocked}
        aria-pressed={thinkingShown}
        aria-label="Thinking"
        data-testid="voice-thinking"
        title={thinkingTitle}
      >
        <Brain size={12} />
      </button>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Let Voice work on the whole computer?" maxWidth="max-w-md" ariaLabel="Whole computer">
        <div className="space-y-2 t-body leading-relaxed text-gray-700 dark:text-gray-300">
          <p>With this, what you ask for by voice is no longer held in one folder:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Files can be read and changed in any folder you can open yourself. System folders and the folders that hold keys and passwords stay closed.</li>
            <li>Commands run in any folder, with the permissions you set under Agent Permissions.</li>
            <li>The screen can be used: LU looks at it, clicks and types. Computer control is switched on for this. <BetaMark feature="computer-control" /></li>
          </ul>
          <p>
            What protects you stays as it is: LU asks before it uses an app for the first time, asks before anything that sends,
            buys or deletes, never types into a password field, keeps away from the blocked apps, and Stop ends everything at once.
          </p>
          <p className="t-micro text-gray-500 dark:text-gray-400">
            Your system asks once more in a window of its own when a voice session first takes this level after LU was started.
          </p>
        </div>
        <ModalActions>
          <ModalButton variant="quiet" onClick={() => setConfirmOpen(false)}>Keep workspace only</ModalButton>
          <ModalButton variant="primary" onClick={allowComputer}>Allow the whole computer</ModalButton>
        </ModalActions>
      </Modal>

      {folderOpen && (
        <AgentWorkspaceDialog
          open
          conversationId="voice"
          initialWorkspace={picked}
          onChoose={(next) => { update({ loopWorkspace: next.kind === 'folder' ? next : null }); setFolderOpen(false) }}
          onClose={() => setFolderOpen(false)}
        />
      )}
    </div>
  )
}
