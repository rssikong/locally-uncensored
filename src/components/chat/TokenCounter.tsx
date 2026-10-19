import { useChatStore } from '../../stores/chatStore'
import { computeContextFill } from '../../lib/token-usage'
import { useActiveContextWindow } from '../../hooks/useActiveContextWindow'
import { useSendSizeStore } from '../../stores/sendSizeStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { shouldAutoCompact, autoCompactHint, resolveCompactThreshold } from '../../lib/compact-trigger'
import { newestCompaction, isModelVisible } from '../../lib/run-compact-command'
// Dieselbe Schreibweise wie die Klapplade darunter. Vorher stand hier
// 8192/1000 und dort 8192/1024, also `8.2k` neben `8K` fuer eine einzige Zahl
// (Gegenprobe G2, 04.09.2026).
import { formatContextWindow } from '../../lib/formatters'
// GH #129: der Nenner sagt jetzt auch, woher er kommt. Eine geratene Zahl
// sieht genauso aus wie eine gemessene, und der Melder hat zwei Wochen lang
// eine geratene fuer eine Zusage gehalten.
import { SOURCE_LABEL } from '../../lib/context-source'
import { HINWEIS_TEXT, PUNKT_FARBE } from '../../lib/hinweis'
import { useGenerationStore } from '../../stores/generationStore'
import { groupCounterSpeaker } from '../../lib/group-counter'
import { groupSpeakers } from '../../lib/group-chat'

export function TokenCounter() {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  // What the agent loops last actually built and sent for this conversation
  // (2.6.6, plan A2). Undefined on a plain chat, where the estimate stands.
  const sent = useSendSizeStore((s) => (activeConversationId ? s.byConv[activeConversationId] : undefined))

  // The denominator is the REAL context window the active model runs with —
  // provider-aware and shared with the Context dropdown so the two never drift
  // (the owner: "muss immer stimmen"). Ollama = the num_ctx we send; LM Studio =
  // loaded_context_length (what it actually loaded), NOT the model's max.
  // GH #167: in a group chat the counter belongs to one speaker, the one
  // answering now or the one opening the next round, and says which. Its
  // window, its own usage anchor, its name (lib/group-counter.ts).
  const conversation = conversations.find((c) => c.id === activeConversationId)
  const generating = useGenerationStore((s) => !!(activeConversationId && s.generating[activeConversationId]))
  const personas = useSettingsStore((s) => s.personas)
  const speaker = groupCounterSpeaker(
    conversation?.messages ?? [],
    conversation?.groupModels,
    generating,
    conversation?.groupModels ? groupSpeakers(conversation.groupModels, conversation.groupPersonas, personas) : undefined,
  )
  const ctx = useActiveContextWindow(0, speaker?.model)
  // MUSS vor dem fruehen `return null` weiter unten stehen. Als dieser Hook
  // dort unten bei seiner Verwendung stand, hatte die Komponente vier Hooks im
  // leeren Chat und fuenf im gefuellten — React 19 wirft dann beim Uebergang
  // „Rendered more hooks than during the previous render", und das ist ein
  // Absturz, kein Warnhinweis. Der Weg dorthin ist alltaeglich: neuer Chat mit
  // einem Cloud-Modell (ContextDropdown rendert die Kinder auch, wenn das
  // Fenster nicht verstellbar ist), erste Nachricht — fertig.
  const autoAn = useSettingsStore((s) => s.settings.autoCompact)
  const autoSchwelleEingestellt = useSettingsStore((s) => s.settings.autoCompactThreshold)

  const messages = conversation?.messages || []

  // Context fill = what the NEXT request will roughly send, anchored on the
  // newest model-reported usage (real promptTokens include system prompt +
  // tools + RAG + history) plus the visible messages after it. Reasoning
  // (`thinking`) is never resent, so it is never counted — the old
  // conversation-high-water over totalTokens pinned this counter at "16.5k"
  // forever after one looping cloud reasoner burned its whole 16,384-token
  // completion budget, while the next real prompt cost 65 tokens (the owner,
  // 2026-07-12). An honest dip after compaction beats a sticky wrong maximum.
  // Messages PLUS the tool catalog: both are the request, both are billed, and
  // the catalog is the bigger half of what a fresh coding step costs. Leaving
  // it out made the meter read about 1.700 tokens low on every step of a
  // coding run, worst exactly where it is otherwise near zero.
  const fill = computeContextFill(
    messages,
    sent && !speaker
      ? { tokens: sent.tokens + sent.toolsTokens, atMessageCount: sent.atMessageCount }
      : undefined,
    speaker ? { anchorModelId: speaker.model } : undefined,
  )
  const rawUsed = fill.used

  if (!activeConversationId || messages.length === 0) return null
  // No window known yet (the very first probe of this model in this session):
  // no number rather than a made-up one. A 16384 stand-in read as a real "16K"
  // (Gegenprobe 01.10.2026).
  if (ctx.sendWindow <= 0 && ctx.contextWindow <= 0) return null

  // The resolved real context window (known here, see the return above). On a
  // paid provider the denominator is the SEND window, not the model window: a
  // 262k-context model whose steps are capped at 64k would otherwise sit quiet
  // at 25 percent forever, the red warning would never fire, and every support
  // case would arrive with a healthy meter next to a drained wallet (plan A2,
  // meter honesty).
  const window = ctx.sendWindow > 0 ? ctx.sendWindow : ctx.contextWindow
  const maxTokens = window
  // Cap the numerator at the active window: a long chat carried onto a
  // smaller-context model shows "8.0k/8.0k" (full), not "20k/8k".
  const usedTokens = Math.min(rawUsed, maxTokens)
  // "Real" = anchored on a non-estimated model report and shown uncapped.
  const isReal = fill.real && usedTokens === rawUsed

  const ratio = maxTokens > 0 ? usedTokens / maxTokens : 0
  // Zwei Toene, kein dritter (`lib/hinweis.ts`). Bis hierher gab es eine
  // mittlere Stufe ab 50 Prozent, und die hat nichts gesagt: halbvoll ist der
  // Normalfall eines laufenden Gespraechs, kein Zwischenfall. Ueber 80 Prozent
  // wird es eng, das traegt Rot. Alles darunter ist ruhiges Grau. Schrift und
  // Balken holen sich dieselbe Aussage aus derselben Datei, damit der Balken
  // nicht eines Tages allein weiterwandert.
  const eng = ratio > 0.8
  const color = eng ? HINWEIS_TEXT.fehler : HINWEIS_TEXT.ruhig
  const barColor = eng ? PUNKT_FARBE.kaputt : PUNKT_FARBE.aus

  const source = ctx.provider === 'lmstudio'
    ? "LM Studio loaded context"
    : ctx.provider === 'ollama'
      ? 'Ollama num_ctx'
      : ctx.provider === 'builtin'
        ? 'LU Engine loaded context'
        : ctx.provider === 'custom'
          ? `server context, ${SOURCE_LABEL[ctx.source]}`
          : `model context, ${SOURCE_LABEL[ctx.source]}`
  const capped = ctx.sendWindow > 0 && ctx.contextWindow > ctx.sendWindow
  // Dieselbe Schreibweise wie die sichtbare Zeile darunter. Bis zur
  // Nachpruefung G3 am 04.09.2026 stand hier `formatCount`, also las der Kunde
  // `82/8K` auf dem Schirm und bekam beim Verweilen mit der Maus auf DERSELBEN
  // Zahl `82 / 8,192 tokens`. Zwei Schreibweisen fuer denselben Wert, auf
  // einem Bildschirm, eine davon unter dem Mauszeiger der anderen.
  const capNote = capped
    ? `. Capped: a step sends at most ${formatContextWindow(maxTokens)} of this model's ${formatContextWindow(ctx.contextWindow)} tokens (Settings, send window), and tool results older than the newest step go out shortened`
    : ''
  const title = fill.source === 'built'
    ? `Last request: ${formatContextWindow(usedTokens)} / ${formatContextWindow(maxTokens)} tokens, the size of the payload actually built for the last step, tool catalog, decay and compaction included${capNote}`
    : isReal
      ? `Context: ${formatContextWindow(usedTokens)} / ${formatContextWindow(maxTokens)} tokens (${source}), anchored on the model's last reported usage (includes system prompt + tools + RAG); reasoning tokens are not context and aren't counted${capNote}`
      : `Estimated: ${formatContextWindow(usedTokens)} / ${formatContextWindow(maxTokens)} tokens (${source}), estimate until the model reports real usage${capNote}`

  // ── Wie weit ist es noch bis zur automatischen Kompaktierung ────────────
  //
  // WARUM UEBERHAUPT: bis hierher stand die Schwelle ausschliesslich in den
  // Einstellungen. Wer sie eingeschaltet hatte, sah im Chat nur den Fuellstand
  // und konnte nicht wissen, ob die naechste Nachricht noch durchgeht oder
  // eine Zusammenfassung ausloest. Die Claude-Code-Desktop-App schreibt genau
  // diesen Satz in ihre Statuszeile, und er ist der Grund, warum dort niemand
  // von einer Kompaktierung ueberrascht wird.
  //
  // WARUM ueber `shouldAutoCompact` und nicht mit einer eigenen Rechnung: die
  // wirksame Schwelle ist NICHT die eingestellte. `shouldAutoCompact` zieht
  // einen Sicherheitsabschlag ab, solange der Fuellstand nur geschaetzt ist —
  // eine hier selbst gerechnete Prozentzahl waere im haeufigsten Fall (kein
  // echter Usage-Report) schlicht die falsche. Dieselbe Funktion zu fragen,
  // die spaeter auch entscheidet, ist der einzige Weg, bei dem Anzeige und
  // Verhalten nicht auseinanderlaufen koennen.
  const sichtbareAnzahl = messages.filter(isModelVisible).length
  // Dieselbe Aufloesung wie im Ausloeser: aus, feste Zahl, oder passend zum
  // Fenster (seit 3.0.7 der Normalfall).
  const autoSchwelle = resolveCompactThreshold(
    { autoCompact: autoAn, autoCompactThreshold: autoSchwelleEingestellt },
    maxTokens,
    // Die 32K-Regel gilt fuer das Modellfenster, nicht fuer das Sendefenster.
    ctx.contextWindow > 0 ? ctx.contextWindow : maxTokens,
  )
  const autoUrteil = autoSchwelle !== null
    ? shouldAutoCompact({
        used: rawUsed,
        window: maxTokens,
        source: fill.source,
        real: fill.real,
        // Ein unbekanntes Fenster kommt hier nicht mehr an (frueher stand
        // dafuer ein 16384er-Notnagel, und 14k auf einem 128k-Modell las sich
        // sekundenlang als "triggers on the next message").
        windowIsTrue: window > 0,
        messageCount: sichtbareAnzahl,
        threshold: autoSchwelle,
        lastCompactAtMessageCount: newestCompaction(conversation?.compactions)?.atMessageCount,
      })
    : null
  const autoHinweis = autoCompactHint(autoUrteil)
  const speakerTitle = speaker ? `${speaker.label}, the speaker this counter follows. ${title}` : title

  // `span`, nicht `div`, und ohne eigenes Padding: seit D-S06 ist dieser
  // Fuellstand die Beschriftung INNERHALB des Kontextfenster-Knopfes
  // (`ContextDropdown`). Ein `div` im `<button>` ist kein gueltiges
  // Phrasing-Content, und das Padding kam sonst zweimal.
  return (
    <span className={`inline-flex items-center gap-1.5 ${color}`} title={autoHinweis ? `${speakerTitle}. ${autoHinweis}` : speakerTitle}>
      <span className="relative block w-12 h-1 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <span
          className={`block h-full rounded-full transition-[width] duration-[var(--motion-slow)] ${barColor}`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
        {/* Die Marke sitzt auf der WIRKSAMEN Schwelle, derselben, die
            entscheidet. Nur gezeichnet, wenn sie ueberhaupt in den Balken
            faellt — eine Marke am Rand behauptet eine Genauigkeit, die zwei
            Pixel nicht tragen. */}
        {autoUrteil && autoUrteil.effectiveThreshold > 0.02 && autoUrteil.effectiveThreshold < 0.98 && (
          <span
            aria-hidden
            data-testid="auto-compact-mark"
            className="absolute top-0 bottom-0 w-px bg-current opacity-50"
            style={{ left: `${autoUrteil.effectiveThreshold * 100}%` }}
          />
        )}
      </span>
      {/* `font-mono tabular-nums` war dasselbe Rezept, nur an der Call-Site
          buchstabiert. `.lu-hud-num` ist die eine Stelle, an der es steht. */}
      {speaker && (
        <span data-testid="counter-speaker" className="text-[0.55rem] truncate max-w-[7rem]">{speaker.label}:</span>
      )}
      <span className="text-[0.55rem] lu-hud-num">
        {formatContextWindow(usedTokens)}/{formatContextWindow(maxTokens)}
      </span>
    </span>
  )
}
