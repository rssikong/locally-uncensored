/**
 * C2.25: the documents an answer used, under the answer. One row per
 * document, a tap shows the passages (B12, see logic/sources.ts).
 */
import { FileText } from 'lucide-react'
import type { Message } from '../../../../types/chat'
import { CHAT_STRINGS } from '../../../strings/chat'
import { Fold } from '../../../ui'
import { groupSources } from './logic/sources'

const S = CHAT_STRINGS.message

export function Sources({ sources }: { sources: Message['sources'] }) {
  const documents = groupSources(sources)
  if (documents.length === 0) return null
  return (
    <div className="m-chat-sources" data-testid="m-chat-sources">
      <strong>{S.sources}</strong>
      {documents.map((doc) => (
        <Fold
          key={doc.name}
          title={doc.name}
          sub={S.sourcePassages(doc.passages.length)}
          icon={FileText}
          label={S.sourceShow(doc.name, doc.passages.length)}
          testid="m-chat-source"
          el="C2.25"
        >
          {() =>
            doc.passages.map((p) => (
              <div className="m-chat-source-passage" key={p.source} data-testid="m-chat-source-passage">
                <span>{S.sourcePlace(p.source, p.passage)}</span>
                <p>{p.cut ? S.sourceCut(p.text) : p.text}</p>
              </div>
            ))
          }
        </Fold>
      ))}
    </div>
  )
}
