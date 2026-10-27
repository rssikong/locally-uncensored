/**
 * E8 Agent and permissions. Route /settings/agent, page, strand 2 (Agent and knowledge).
 *
 * The app wide level of every tool group a phone has (parts/permission-groups.ts),
 * the two limits of a sub agent, the Agent mode intro and the reset.
 * With a chat model that runs on this phone the row "Sub agents" is locked with
 * its reason and the two limits are not shown (lib/phone-sub-agents.ts).
 * Terminal, Desktop, Image and Video have no tools on a phone and are not listed.
 */
import { Database } from 'lucide-react'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { SUB_AGENTS_NEED_CLOUD } from '../../../lib/phone-sub-agents'
import { useAgentModeStore } from '../../../stores/agentModeStore'
import { usePermissionStore } from '../../../stores/permissionStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { nav } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, ListGroup, NumberField, Page, Row, toast } from '../../ui'
import './parts/agent.css'
import { levelOf, PERMISSION_GROUPS, setAppLevel } from './parts/permission-groups'
import { PermissionRow } from './parts/PermissionRows'
import { useSubAgentsOffered } from './parts/sub-agents-here'

const S = T.agentSettings
/** The most a phone lets a sub agent do in one run. */
export const SUB_CALLS_MAX = 50
export const SUB_STEPS_MAX = 25

export default function AgentPermissionsPage() {
  const global = usePermissionStore((s) => s.globalPermissions)
  const perTool = usePermissionStore((s) => s.perToolOverrides)
  const calls = useSettingsStore((s) => s.settings.subAgentMaxToolCalls ?? 0)
  const steps = useSettingsStore((s) => s.settings.subAgentMaxIterations ?? 0)
  const introSeen = useAgentModeStore((s) => s.tutorialCompleted)
  const subAgents = useSubAgentsOffered()

  const reset = async () => {
    const yes = await nav.confirm({ title: S.resetTitle, text: S.resetText, confirmLabel: S.resetConfirm, tone: 'danger', testid: 'permissions-reset' })
    if (!yes) return
    usePermissionStore.getState().resetToDefaults()
    toast(S.resetDone, { testid: 'permissions-reset-done' })
  }

  return (
    <Page title={S.title} screen="settings-agent">
      <h2 className="m-label m-group-label">{S.groupsTitle}</h2>
      <div className="m-group" data-testid="m-agent-groups">
        {PERMISSION_GROUPS.map((group) => (
          <PermissionRow key={group.id} group={group} level={levelOf(group, global, perTool)} onChange={(level) => setAppLevel(group, level)} lockedReason={group.id === 'subagents' && !subAgents ? SUB_AGENTS_NEED_CLOUD : undefined} idPrefix="m-agent-perm" el="E8.1" />
        ))}
      </div>
      <p className="m-ag-text">{T.permissions.explain}</p>
      <ListGroup>
        <Row title={S.memoryRow} subtitle={S.memoryRowSub} icon={Database} onPress={() => nav.push('/settings/memory')} testid="m-agent-memory" el="E8.1" />
      </ListGroup>

      {subAgents ? (
        <>
          <h2 className="m-label m-group-label">{S.subTitle}</h2>
          <div className="m-group">
            <div className="m-ag-seg-row" data-testid="m-agent-sub-calls-row">
              <span className="m-ag-seg-title">{S.subCalls}</span>
              <span className="m-ag-seg-sub">{`${S.subCallsSub} ${S.subValue(calls, DEFAULT_SETTINGS.subAgentMaxToolCalls)}`.trim()}</span>
              <NumberField label={S.subCalls} value={calls} min={0} max={SUB_CALLS_MAX} onChange={(value) => useSettingsStore.getState().updateSettings({ subAgentMaxToolCalls: Math.round(value) })} testid="m-agent-sub-calls" el="E8.2" />
            </div>
            <div className="m-ag-seg-row" data-testid="m-agent-sub-steps-row">
              <span className="m-ag-seg-title">{S.subSteps}</span>
              <span className="m-ag-seg-sub">{`${S.subStepsSub} ${S.subValue(steps, DEFAULT_SETTINGS.subAgentMaxIterations)}`.trim()}</span>
              <NumberField label={S.subSteps} value={steps} min={0} max={SUB_STEPS_MAX} onChange={(value) => useSettingsStore.getState().updateSettings({ subAgentMaxIterations: Math.round(value) })} testid="m-agent-sub-steps" el="E8.3" />
            </div>
          </div>
          <p className="m-ag-text">{S.subDefault(DEFAULT_SETTINGS.subAgentMaxToolCalls)}</p>
        </>
      ) : null}

      <ListGroup>
        <Row
          title={S.intro}
          subtitle={introSeen ? S.introSub : S.introAlready}
          chevron={false}
          disabled={!introSeen}
          disabledReason={S.introAlready}
          onPress={() => {
            useAgentModeStore.getState().resetTutorial()
            toast(S.introDone, { testid: 'agent-intro-reset' })
          }}
          testid="m-agent-intro"
          el="E8.4"
        />
      </ListGroup>
      <div className="m-ag-actions">
        <Button risk="destructive" block onPress={() => void reset()} testid="m-agent-reset" el="E8.5">
          {S.reset}
        </Button>
      </div>
    </Page>
  )
}
