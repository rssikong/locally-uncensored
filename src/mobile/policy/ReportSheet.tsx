/**
 * The sheet "report": why, an optional note, "Send report".
 * Opened only by openReport() in policy/report.ts.
 */
import { useState } from 'react'
import { useSheet } from '../nav/context'
import { POLICY, REPORT_REASONS, type ReportReason } from '../strings/policy'
import { Button, ListGroup, Row, Sheet, TextArea, toast } from '../ui'
import { REPORT_NOTE_MAX, reportEndpoint, sendReport, type ReportTarget } from './report'

export default function ReportSheet() {
  const sheet = useSheet<ReportTarget | undefined>()
  const target = sheet.props
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [withText, setWithText] = useState(true)
  const [busy, setBusy] = useState(false)
  const hasText = !!target?.excerpt?.trim()
  // A build without a report service keeps every report on the phone. The sheet says that, and not "goes to the LU team" (M4).
  const service = reportEndpoint() !== null

  const send = () => {
    if (!target || !reason) return
    setBusy(true)
    sendReport({ ...target, excerpt: hasText && withText ? target.excerpt : undefined, reason, note }).then(
      (outcome) => {
        toast(outcome === 'sent' ? POLICY.reportSent : service ? POLICY.reportQueued : POLICY.reportQueuedNoService, { testid: `report-${outcome}` })
        sheet.close()
      },
      () => {
        setBusy(false)
        toast(POLICY.reportNotSaved, { tone: 'error', testid: 'report-failed' })
      },
    )
  }

  return (
    <Sheet
      title={POLICY.reportTitle}
      footer={
        <Button
          variant="primary"
          block
          busy={busy}
          disabled={!reason || !target}
          disabledReason={!reason ? POLICY.reportPickReason : undefined}
          onPress={send}
          // It goes to the LU team and cannot be taken back: a sweep never taps it.
          risk="destructive"
          testid="m-report-send"
        >
          {service ? POLICY.reportSend : POLICY.reportSave}
        </Button>
      }
    >
      <p className="m-policy-text m-pad" data-testid="m-report-intro" data-m-service={service ? 'yes' : 'no'}>
        {service ? POLICY.reportIntro : POLICY.reportIntroNoService}
        {target?.source === 'local' && target.origin === 'computer'
          ? ` ${service ? POLICY.reportSendsComputer : POLICY.reportSendsComputerNoService}`
          : target?.source === 'local'
            ? ` ${service ? POLICY.reportSendsLocal : POLICY.reportSendsLocalNoService}`
            : ''}
      </p>
      <ListGroup title={POLICY.reportReasonLabel} role="radiogroup" testid="m-report-reasons">
        {REPORT_REASONS.map((item) => (
          <Row
            key={item.id}
            title={item.label}
            radio={{ checked: reason === item.id, onSelect: () => setReason(item.id) }}
            testid={`m-report-reason-${item.id}`}
          />
        ))}
      </ListGroup>
      {hasText ? (
        <ListGroup>
          <Row
            title={POLICY.reportIncludeText}
            subtitle={POLICY.reportIncludeTextHint}
            switch={{ checked: withText, onChange: setWithText }}
            testid="m-report-include-text"
          />
        </ListGroup>
      ) : null}
      <div className="m-pad">
        <TextArea
          label={POLICY.reportNoteLabel}
          value={note}
          onChange={setNote}
          placeholder={POLICY.reportNotePlaceholder}
          rows={3}
          maxLength={REPORT_NOTE_MAX}
          testid="m-report-note"
        />
      </div>
    </Sheet>
  )
}
