// MIRRORED from the web app (stores/createOrderStore.ts), without its comments. Do not edit here.
// scripts/create-chat-mirror.mjs writes this file, and web-parity.test.ts
// holds it to its source. Only the import paths differ, the places listed
// under PATCHES in that script, and the classes under CLASSES.
import { CREATE_CHAT_ORIGIN } from '../lib/create/chat-origin'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { v4 as uuid } from 'uuid'
import { createSafeStorage } from '../lib/storage-quota'
import {
  adoptInput, cancelJob, getJob, isActiveJob, pollJob, submitCloudJob, uploadInput,
} from '../lib/create/bridge/cloud-jobs'
import {
  approveDifference, approveOrder, conversationSpent, declineOrder, executeOrder, interruptedRuns, markInterrupted,
  orderIdFromToolResult, resumeInterrupted, settleInterrupted, timeoutFor,
  type ExecuteDeps, type Order,
} from '../lib/create/order'
import type { HandleContext, HandleResult } from '../lib/create/handles'
import { supersedeOpenOrders } from '../lib/create/chat-control'

type Deps = Omit<ExecuteDeps, 'onUpdate' | 'signal'>

interface CreateOrderState {
  byConversation: Record<string, Order[]>

  add: (order: Order) => void
  put: (order: Order) => void
  get: (orderId: string) => Order | undefined
  ordersFor: (conversationId: string | null | undefined) => Order[]
  spent: (conversationId: string) => number
  results: (conversationId: string) => HandleResult[]
  findForToolResult: (conversationId: string, toolName: string, result: unknown) => Order | null

  approve: (orderId: string) => void
  decline: (orderId: string) => void
  approveDifference: (orderId: string) => void
  run: (orderId: string, deps: Deps) => Promise<Order>
  isRunning: (orderId: string) => boolean
  stop: (orderId: string) => void
  catchUp: (orderId: string, deps?: Pick<ExecuteDeps, 'getJob' | 'pollJob'> & Partial<Pick<ExecuteDeps, 'cancelJob'>>) => Promise<void>
}

const controllers = new Map<string, AbortController>()

function locate(state: CreateOrderState, orderId: string): Order | undefined {
  for (const list of Object.values(state.byConversation)) {
    const hit = list.find((o) => o.id === orderId)
    if (hit) return hit
  }
  return undefined
}

const catchingUp = new Set<string>()

export const useCreateOrderStore = create<CreateOrderState>()(
  persist(
    (set, get) => ({
      byConversation: {},

      add: (order) =>
        set((s) => ({
          byConversation: {
            ...s.byConversation,
            [order.conversationId]: [...supersedeOpenOrders(s.byConversation[order.conversationId] ?? []), order],
          },
        })),

      put: (order) =>
        set((s) => ({
          byConversation: {
            ...s.byConversation,
            [order.conversationId]: (s.byConversation[order.conversationId] ?? []).map((o) => (o.id === order.id ? order : o)),
          },
        })),

      get: (orderId) => locate(get(), orderId),

      ordersFor: (conversationId) => (conversationId && get().byConversation[conversationId]) || [],

      spent: (conversationId) => conversationSpent(get().ordersFor(conversationId)),

      results: (conversationId) => {
        const out: HandleResult[] = []
        for (const order of get().ordersFor(conversationId)) {
          for (const item of order.items) for (const run of item.runs) {
            if (run.status === 'done' && run.jobId && run.resultUrl) {
              out.push({
                jobId: run.jobId,
                kind: run.kind,
                createdAt: order.approvedAt ?? order.createdAt,
                title: item.runs.length > 1 ? `${item.title} · ${run.title}` : item.title,
              })
            }
          }
        }
        return out
      },

      findForToolResult: (conversationId, toolName, result) => {
        const id = orderIdFromToolResult(toolName, result)
        if (!id) return null
        return get().ordersFor(conversationId).find((o) => o.id === id) ?? null
      },

      approve: (orderId) => {
        const order = locate(get(), orderId)
        if (order) get().put(approveOrder(order, Date.now()))
      },

      decline: (orderId) => {
        const order = locate(get(), orderId)
        if (order) get().put(declineOrder(order))
      },

      approveDifference: (orderId) => {
        const order = locate(get(), orderId)
        if (order) get().put(approveDifference(order))
      },

      run: async (orderId, deps) => {
        const order = locate(get(), orderId)
        if (!order) throw new Error('Unknown order')
        if (controllers.has(orderId)) return order
        const controller = new AbortController()
        controllers.set(orderId, controller)
        try {
          return await executeOrder(order, { ...deps, signal: controller.signal, onUpdate: (next) => get().put(next) })
        } finally {
          if (controllers.get(orderId) === controller) controllers.delete(orderId)
          const left = locate(get(), orderId)
          if (left && interruptedRuns(left).length) void get().catchUp(orderId, { getJob: deps.getJob, pollJob: deps.pollJob, cancelJob: deps.cancelJob })
        }
      },

      isRunning: (orderId) => controllers.has(orderId),

      stop: (orderId) => {
        controllers.get(orderId)?.abort()
      },

      catchUp: async (orderId, deps = { getJob, pollJob }) => {
        if (catchingUp.has(orderId) || controllers.has(orderId)) return
        catchingUp.add(orderId)
        const controller = new AbortController()
        controllers.set(orderId, controller)
        try {
          for (const { n, index, jobId } of interruptedRuns(locate(get(), orderId) ?? ({ items: [] } as unknown as Order))) {
            try {
              let job = await deps.getJob(jobId)
              if (isActiveJob(job)) {
                const now = locate(get(), orderId)
                if (now) get().put(resumeInterrupted(now, n, index))
                const run = locate(get(), orderId)?.items.find((i) => i.n === n)?.runs[index]
                try {
                  job = await deps.pollJob(jobId, { timeoutMs: run ? timeoutFor(run) : undefined, signal: controller.signal })
                } catch (err) {
                  if (!controller.signal.aborted) throw err
                  await (deps.cancelJob ?? cancelJob)(jobId).catch(() => null)
                  job = await deps.getJob(jobId)
                }
              }
              const now = locate(get(), orderId)
              if (now) get().put(settleInterrupted(now, n, index, job))
            } catch {
              const now = locate(get(), orderId)
              if (now?.state === 'running') get().put(markInterrupted(now))
            }
          }
        } finally {
          catchingUp.delete(orderId)
          if (controllers.get(orderId) === controller) controllers.delete(orderId)
        }
      },
    }),
    {
      name: 'LU-create-orders',
      storage: createJSONStorage(() => createSafeStorage()),
      partialize: (s) => ({ byConversation: s.byConversation }),
      merge: (persisted, current) => {
        const saved = (persisted as { byConversation?: Record<string, Order[]> } | undefined)?.byConversation ?? {}
        const byConversation = Object.fromEntries(
          Object.entries(saved).map(([conv, list]) => [conv, list.map(markInterrupted)]),
        )
        return { ...current, byConversation }
      },
    },
  ),
)

export function cloudOrderDeps(handles: () => Omit<HandleContext, 'items'>): Deps {
  return {
    submitCloudJob: (submit) => submitCloudJob(submit, CREATE_CHAT_ORIGIN),
    uploadInput: (file, role) => uploadInput(file, role, CREATE_CHAT_ORIGIN),
    adoptInput: (jobId, role) => adoptInput(jobId, role, CREATE_CHAT_ORIGIN),
    pollJob, cancelJob, getJob,
    handles,
    newRequestId: () => uuid(),
  }
}
