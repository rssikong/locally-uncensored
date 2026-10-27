import { useEffect, useState } from 'react'
import { SharedChatsSettings } from './SharedChatsSettings'
import { useRemoteStore, type AnnounceInfo, type DeviceRights } from '../../stores/remoteStore'
import { backendCall } from '../../api/backend'
import { isMlxImageHost } from '../../api/mlx-image'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_REMOTE_PAGE_TITLE, MAX_REMOTE_PAGE_TITLE } from '../../lib/remote-page-title'
import { Globe, KeyRound, Shield, Smartphone, Tag, Trash2 } from 'lucide-react'

/** The five rights of a paired phone, in the order the panel shows them. */
const DEVICE_RIGHTS: { key: keyof DeviceRights; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'agent', label: 'Web tools' },
  { key: 'files', label: 'Files' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'create', label: 'Create' },
]

/** "3 min ago", "Oct 17": when a paired phone was last seen. Pure + exported for tests. */
export function lastSeenLabel(unixSeconds: number, nowMs: number = Date.now()): string {
  if (!unixSeconds) return 'never'
  const diff = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** The second line of a paired phone in the list: platform, app version,
 *  fingerprint, last seen. Pure + exported for tests. */
export function deviceDetails(dev: { platform: string; app_version: string; fingerprint: string; last_seen: number }, nowMs: number = Date.now()): string {
  return [dev.platform, dev.app_version && `LU ${dev.app_version}`, dev.fingerprint && `ID ${dev.fingerprint}`, `last seen ${lastSeenLabel(dev.last_seen, nowMs)}`].filter(Boolean).join(', ')
}

/** What the panel says about the address directory, or null for nothing.
 *  Pure + exported for tests. */
export function announceLine(a: AnnounceInfo, anywhere: boolean, nowMs: number = Date.now()): { text: string; failed: boolean } | null {
  if (!anywhere) return null
  const at = (unix: number) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  switch (a.state) {
    case 'ok':
      return { text: `Findable from anywhere. Address last announced ${a.lastOkAt ? at(a.lastOkAt) : 'just now'}.`, failed: false }
    case 'announcing':
      return { text: 'Announcing the address of this computer...', failed: false }
    case 'failed': {
      const wait = a.nextTryAt ? Math.max(0, Math.ceil((a.nextTryAt * 1000 - nowMs) / 60000)) : null
      const again = wait === null ? '' : wait <= 1 ? ' Trying again in a moment.' : ` Trying again in ${wait} min.`
      return { text: `The address could not be announced: ${a.error ?? 'unknown error'}${again}`, failed: true }
    }
    case 'idle':
      return { text: 'Not findable yet: the address is announced once Remote runs with Internet.', failed: false }
    default:
      return null
  }
}

export function RemoteAccessSettings() {
  const {
    enabled, connectedDevices, permissions,
    refreshStatus, refreshDevices, setPermissions,
    pairedDevices, sealedInfo, refreshPairedDevices, forgetDevice, setDeviceRights, setAnywhere,
    announce, legacy, setLegacyAccess, newDeviceRights, setNewDeviceRights,
  } = useRemoteStore()
  const announced = announceLine(announce, sealedInfo.anywhere)
  const [forgetting, setForgetting] = useState<string | null>(null)

  useEffect(() => {
    void refreshPairedDevices()
  }, [refreshPairedDevices])
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const pageTitle = useSettingsStore((s) => s.settings.remotePageTitle ?? '')
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  useEffect(() => {
    refreshStatus()
    refreshDevices()
    const interval = setInterval(() => {
      if (enabled) refreshDevices()
    }, 10000)
    return () => clearInterval(interval)
    // `refreshStatus`/`refreshDevices` sind Store-Actions aus dem create()-
    // Initializer: ihre Referenz entsteht einmal und aendert sich nie. Der
    // Effekt laeuft dadurch weiterhin nur bei einem Wechsel von `enabled`.
  }, [enabled, refreshDevices, refreshStatus])

  // Bug #10: the trash icon called an empty handler. Wire it up to the
  // existing /remote-api/disconnect command and refetch afterwards so the
  // row actually disappears.
  const handleDisconnect = async (deviceId: string) => {
    setDisconnecting(deviceId)
    try {
      await backendCall('disconnect_remote_device', { deviceId })
    } catch {
      // Fallback: some builds only expose the HTTP endpoint
      try {
        await fetch(`http://127.0.0.1:11435/remote-api/disconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deviceId }),
        })
      } catch { /* non-fatal */ }
    } finally {
      setDisconnecting(null)
      await refreshDevices()
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.55rem] text-gray-600">
        Remote access is now controlled from the <span className="text-gray-400 font-medium">Remote</span> tab in the sidebar. Use <span className="text-gray-400 font-medium">Dispatch</span> to start a remote chat session.
      </p>

      {/* GitHub #19: the phone's tab name. The Rust server writes it into
          the page it serves (lib/remote-page-title.ts). */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Tag size={12} className="text-gray-500" />
          <label htmlFor="remote-page-title" className="t-micro font-medium text-gray-400">Tab name on your phone</label>
        </div>
        <input
          id="remote-page-title"
          type="text"
          value={pageTitle}
          maxLength={MAX_REMOTE_PAGE_TITLE}
          placeholder={DEFAULT_REMOTE_PAGE_TITLE}
          onChange={(e) => updateSettings({ remotePageTitle: e.target.value })}
          className="w-full px-2 py-1 rounded bg-transparent border border-gray-300 dark:border-white/8 t-micro text-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-400 dark:focus:border-white/20"
        />
        <p className="t-micro text-gray-500 dark:text-gray-600">
          The name of the browser tab and of the home screen icon. Leave it empty for {DEFAULT_REMOTE_PAGE_TITLE}. Reload the page on the phone to see a new name.
        </p>
      </div>

      {/* Shared chats (CHATS-V1.md) */}
      <SharedChatsSettings />

      {/* Permissions */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Shield size={12} className="text-gray-500" />
          <span className="text-[0.65rem] font-medium text-gray-400">Permissions</span>
        </div>
        {([
          { key: 'filesystem' as const, label: 'Filesystem Access', desc: 'Agent file read/write (sandboxed to the chat workspace)' },
          // The two engine-named scopes read differently per platform: macOS
          // has no ComfyUI to install or start, so naming it here would grant
          // the phone a power this machine does not have.
          { key: 'downloads' as const, label: 'Downloads & Installs', desc: isMlxImageHost() ? 'Model downloads, engine install' : 'Model downloads, ComfyUI/Ollama install' },
          { key: 'process_control' as const, label: 'Process Control', desc: isMlxImageHost() ? 'Start/stop the local engines' : 'Start/stop ComfyUI, Ollama' },
          { key: 'shell' as const, label: 'Shell & Code Execution', desc: 'Run shell commands + code from your phone. Risky, leave OFF unless you trust the network.' },
          // Create over the desktop (lib/remote-create-runner.ts): the phone
          // sends a prompt, this computer renders, the phone gets only its own
          // results back.
          { key: 'create' as const, label: 'Create', desc: 'Let paired phones make images and videos on this computer' },
        ]).map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between">
            <div>
              <p className="text-[0.65rem] text-gray-700 dark:text-gray-300">{label}</p>
              <p className="text-[0.5rem] text-gray-500 dark:text-gray-600">{desc}</p>
            </div>
            <button
              onClick={() => setPermissions({ ...permissions, [key]: !permissions[key] })}
              role="switch"
              aria-checked={permissions[key] === true}
              aria-label={label}
              className={`w-8 h-4 rounded-full transition-all relative ${
                permissions[key] ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                permissions[key] ? 'left-4' : 'left-0.5'
              }`} />
            </button>
          </div>
        ))}
      </div>

      {/* Paired phones of the sealed channel (REMOTE-PROTOKOLL v2). Each has
          its own rights; the switches above stay the upper bound. */}
      {sealedInfo.available && (
        <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Globe size={12} className="text-gray-500" />
              <span className="t-micro font-medium text-gray-400">Reach this computer from anywhere</span>
            </div>
            <button
              role="switch"
              aria-checked={sealedInfo.anywhere}
              aria-label="Reach this computer from anywhere"
              onClick={() => void setAnywhere(!sealedInfo.anywhere)}
              className={`w-8 h-4 rounded-full transition-colors relative ${sealedInfo.anywhere ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white ${sealedInfo.anywhere ? 'left-4' : 'left-0.5'}`} />
            </button>
          </div>
          <p className="t-micro text-gray-500 dark:text-gray-600">
            When LU starts and a phone is paired, Remote and the encrypted internet tunnel come up by themselves, and the tunnel address is announced to lu-labs.ai so paired phones find this computer. Over the internet only paired phones get in. At home the browser page and older phones without pairing get in only while you allow it below.
          </p>
          {announced && (
            <p
              role={announced.failed ? 'alert' : 'status'}
              className={`t-micro ${announced.failed ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
              {announced.text}
            </p>
          )}

          {legacy.needsConsent && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="t-micro text-gray-700 dark:text-gray-300">Browser page and older phones</p>
                <p className="t-micro text-gray-500 dark:text-gray-600">
                  {legacy.until
                    ? `Open until ${new Date(legacy.until * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}. The six-digit code still shows only while the QR panel is open.`
                    : 'Closed while phones are paired. Open it for 30 minutes when you need the browser page or the code login of an older LU app.'}
                </p>
              </div>
              <button
                onClick={() => void setLegacyAccess(!legacy.until)}
                className="t-micro px-1.5 py-0.5 rounded border border-gray-300 dark:border-white/10 text-gray-500 hover:text-gray-300 shrink-0"
              >
                {legacy.until ? 'Close now' : 'Allow for 30 min'}
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-1">
            <Smartphone size={12} className="text-gray-500" />
            <span className="t-micro font-medium text-gray-400">Paired phones ({pairedDevices.length})</span>
          </div>
          {pairedDevices.length === 0 && (
            <p className="t-micro text-gray-500 dark:text-gray-600">
              None yet. Start Remote and scan the QR with the LU app.
            </p>
          )}
          {pairedDevices.map((dev) => (
            <div key={dev.device_id} className="space-y-1 py-1">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="t-micro text-gray-700 dark:text-gray-300 truncate"><bdi>{dev.name || 'Phone'}</bdi></p>
                  <p className="t-micro text-gray-500 dark:text-gray-600 truncate" title="The same ID as in the pairing request on this computer and in the LU app.">
                    {deviceDetails(dev)}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    setForgetting(dev.device_id)
                    try { await forgetDevice(dev.device_id) } finally { setForgetting(null) }
                  }}
                  disabled={forgetting === dev.device_id}
                  className="t-micro px-1.5 py-0.5 rounded hover:bg-red-500/15 text-gray-500 hover:text-red-400 disabled:opacity-40 shrink-0"
                  title="Disconnect this phone. It has to pair again."
                >
                  Disconnect
                </button>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label={`Rights of ${dev.name || 'this phone'}`}>
                {DEVICE_RIGHTS.map(({ key, label }) => (
                  <button
                    key={key}
                    aria-pressed={dev.rights[key]}
                    onClick={() => void setDeviceRights(dev.device_id, { ...dev.rights, [key]: !dev.rights[key] })}
                    className={`t-micro px-1.5 py-0.5 rounded border transition-colors ${dev.rights[key] ? 'border-blue-500/40 text-blue-500 dark:text-blue-400' : 'border-gray-300 dark:border-white/10 text-gray-500'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="space-y-1 pt-1">
            <p className="t-micro text-gray-500 dark:text-gray-600">New phones start with</p>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Rights of newly paired phones">
              {DEVICE_RIGHTS.map(({ key, label }) => (
                <button
                  key={key}
                  aria-pressed={newDeviceRights[key]}
                  onClick={() => void setNewDeviceRights({ ...newDeviceRights, [key]: !newDeviceRights[key] })}
                  className={`t-micro px-1.5 py-0.5 rounded border transition-colors ${newDeviceRights[key] ? 'border-blue-500/40 text-blue-500 dark:text-blue-400' : 'border-gray-300 dark:border-white/10 text-gray-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-1.5 pt-1">
            <KeyRound size={12} className="text-gray-500 shrink-0 mt-px" />
            <p className="t-micro text-gray-500 dark:text-gray-600">
              {sealedInfo.storage === 'file'
                ? 'The key of this computer is stored in a file on this computer, readable only by your user.'
                : 'The key of this computer is stored in the system keychain.'}
            </p>
          </div>
        </div>
      )}

      {/* Connected Devices */}
      {connectedDevices.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-white/[0.06]">
          <div className="flex items-center gap-1.5">
            <Smartphone size={12} className="text-gray-500" />
            <span className="text-[0.65rem] font-medium text-gray-400">
              Connected Devices ({connectedDevices.length})
            </span>
          </div>
          {connectedDevices.map((dev) => (
            <div key={dev.id} className="flex items-center justify-between py-1">
              <div>
                <p className="text-[0.6rem] text-gray-700 dark:text-gray-300">{dev.ip}</p>
                <p className="text-[0.5rem] text-gray-500 dark:text-gray-600 truncate max-w-[200px]">{dev.user_agent}</p>
              </div>
              <button
                onClick={() => handleDisconnect(dev.id)}
                disabled={disconnecting === dev.id}
                className="p-1 hover:bg-red-500/15 rounded text-gray-500 dark:text-gray-600 hover:text-red-400 disabled:opacity-40"
                title="Disconnect"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
