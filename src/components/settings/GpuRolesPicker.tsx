// 3.0.8 (A2, .molot): one card for the chat, another for pictures and video.
// Shown only with two or more cards; with one card nothing changes and this
// section is not there. The forwarding lives in Rust (commands/gpu_roles.rs),
// this is the pick and a readout of what each service will be started with.

import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { backendCall, isTauri } from '../../api/backend'
import { normalizeGpuRoles, gpuRolesSeparate, sameCard } from '../../lib/gpu-roles'
import type { GpuRef, GpuRoles } from '../../types/settings'
import { Hinweis } from '../ui/Hinweis'
import { HINWEIS_TEXT } from '../../lib/hinweis'
import { formatBytes } from '../../lib/formatters'

export interface RoleCard {
  index: number
  vendor: string
  name: string
  memory_mib: number | null
}

interface RolePlan {
  service: string
  env: string[]
  args: string[]
  note?: string | null
}

const PICKABLE = new Set(['nvidia', 'amd', 'intel'])

/** The cards a role can be pinned to: the vendors LU can forward a pick to. */
export function roleCards(gpus: RoleCard[]): RoleCard[] {
  return gpus.filter((g) => PICKABLE.has(g.vendor))
}

function keyOf(r: GpuRef | null): string {
  return r ? `${r.vendor}:${r.index}` : ''
}

function label(g: RoleCard): string {
  const mem = g.memory_mib ? ` · ${formatBytes(g.memory_mib * 1024 * 1024)}` : ''
  return `#${g.index} ${g.name}${mem}`
}

export function GpuRolesPicker({ gpus }: { gpus: RoleCard[] }) {
  const { settings, updateSettings } = useSettingsStore()
  const roles = useMemo(() => normalizeGpuRoles(settings.gpuRoles), [settings.gpuRoles])
  const cards = useMemo(() => roleCards(gpus), [gpus])
  const [plan, setPlan] = useState<RolePlan[] | null>(null)
  const [changed, setChanged] = useState(false)

  // Rust holds the pick in memory; every change goes down at once, so the
  // next start of ComfyUI, Ollama or the LU Engine reads it.
  useEffect(() => {
    backendCall('set_gpu_roles', { roles }).catch(() => {})
  }, [roles])

  // The readout: what each service would get. Asked again after a change.
  useEffect(() => {
    if (!isTauri()) return
    let live = true
    backendCall<RolePlan[]>('describe_gpu_roles')
      .then((p) => { if (live) setPlan(Array.isArray(p) ? p : null) })
      .catch(() => { if (live) setPlan(null) })
    return () => { live = false }
  }, [roles])

  if (cards.length < 2) return null

  const pick = (role: keyof GpuRoles, key: string) => {
    const card = cards.find((g) => `${g.vendor}:${g.index}` === key)
    const ref: GpuRef | null = card ? { vendor: card.vendor as GpuRef['vendor'], index: card.index, name: card.name } : null
    updateSettings({ gpuRoles: { ...roles, [role]: ref } })
    setChanged(true)
  }

  const select = (role: keyof GpuRoles, title: string, help: string) => (
    <label className="block">
      <span className="t-micro text-gray-700 dark:text-gray-300">{title}</span>
      <select
        value={keyOf(roles[role])}
        onChange={(e) => pick(role, e.target.value)}
        aria-label={title}
        className="mt-0.5 w-full rounded border border-gray-300 dark:border-white/10 bg-white dark:bg-white/[0.03] px-1.5 py-1 t-micro text-gray-800 dark:text-gray-200"
      >
        <option value="">Same as above</option>
        {cards.map((g) => (
          <option key={`${g.vendor}:${g.index}`} value={`${g.vendor}:${g.index}`}>{label(g)}</option>
        ))}
      </select>
      <span className="block t-micro text-gray-500 mt-0.5 leading-relaxed">{help}</span>
    </label>
  )

  const shared = !!roles.chat && !!roles.comfy && sameCard(roles.chat, roles.comfy)

  return (
    <div className="pt-2 border-t border-white/[0.06] space-y-2" data-testid="gpu-roles">
      <div>
        <div className="t-micro text-gray-700 dark:text-gray-300 font-medium">Card per task</div>
        <div className="t-micro text-gray-500 mt-0.5 leading-relaxed">
          Chat on one card, pictures and video on the other, so the chat stays fast while a video renders.
        </div>
      </div>
      {select('chat', 'Chat (LU Engine, Ollama)', 'The chat model loads onto this card only.')}
      {select('comfy', 'Pictures and video (ComfyUI)', 'ComfyUI sees this card only.')}
      {gpuRolesSeparate(roles) && (
        <Hinweis>
          Two cards: LU no longer takes the chat model off its card to make room for a picture or a video.
        </Hinweis>
      )}
      {shared && (
        <Hinweis>
          Both on the same card: the chat model still has to make room while a video renders.
        </Hinweis>
      )}
      {changed && (
        <p className={`t-micro leading-relaxed ${HINWEIS_TEXT.ruhig}`} data-testid="gpu-roles-restart-hint">
          A running ComfyUI and a loaded chat model keep their card. Restart ComfyUI and load the chat model again to apply the change.
        </p>
      )}
      {plan && plan.length > 0 && (
        <details className="t-micro text-gray-500">
          <summary className="cursor-pointer select-none">What each service is started with</summary>
          <ul className="mt-1 space-y-1" data-testid="gpu-roles-plan">
            {plan.map((p) => (
              <li key={p.service}>
                <span className="text-gray-400">{p.service}:</span>{' '}
                <span className="font-mono">{[...p.env, ...p.args].join(' ') || 'every card (no pick)'}</span>
                {p.note && <span className="block">{p.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
