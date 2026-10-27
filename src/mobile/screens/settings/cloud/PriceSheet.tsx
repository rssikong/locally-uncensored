/**
 * G13 Price of this answer. Sheet "price", opened with nav.openSheet('price'),
 * strand 5 (Account, cloud, settings).
 *
 * Says in one or two sentences what the next answer of the picked model
 * costs: nothing on this phone, nothing inside the daily Flash allowance of a
 * paid plan, or credits. The rule is parts/price.ts. Whether the sheet may
 * point to plans (a button, one sentence, or nothing at all) follows
 * storePolicy().purchase, like every other surface that touches buying.
 */
import { ExternalLink } from 'lucide-react'
import { formatCount } from '../../../../lib/formatters'
import { useFlashBillingStore } from '../../../../lib/flash-ui'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useModelStore } from '../../../../stores/modelStore'
import { nav, useSheet } from '../../../nav'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Button, Sheet, Tag } from '../../../ui'
import { chatModelDirect, chatModelLabel } from '../../chat/parts/model-name'
import { DIRECT_MARK, DIRECT_SENTENCE } from '../../../policy'
import { creditsView } from '../parts/account-view'
import { Block, Hint } from '../parts/layout'
import { LINKS, openLink } from '../parts/links'
import { storePolicy } from '../parts/policy'
import { priceCopy, priceView } from '../parts/price'

const T = SETTINGS_STRINGS.price

export default function PriceSheet() {
  const { props, close } = useSheet<{ model?: string } | undefined>()
  const active = useModelStore((s) => s.activeModel)
  const models = useModelStore((s) => s.models)
  const paidPlan = useCloudAuthStore((s) => s.paidPlan)
  const quota = useCloudAuthStore((s) => s.quota)
  const name = props?.model ?? active
  const model = name ? (models.find((m) => m.name === name) ?? null) : null
  const flash = model && 'flash' in model ? model.flash : undefined
  const notice = useFlashBillingStore((s) => (flash ? s.entries[flash.billingKey] : undefined))
  const credits = creditsView(quota)
  const view = priceView({
    model: model ? { provider: model.provider, flash } : null,
    paidPlan,
    notice: notice ?? null,
    creditsLeft: credits ? credits.leftNumber : null,
  })

  // What the sheet may say about buying is the store's call (parts/store-rules.ts): a button, one sentence, or nothing.
  const copy = priceCopy(view, storePolicy().purchase, formatCount)
  const lines = copy.lines

  return (
    <Sheet
      title={T.title}
      footer={
        <div className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          <Button
            variant="primary"
            block
            onPress={() => {
              close()
              nav.openSheet('model')
            }}
            testid="m-price-change-model"
            el="G13.1"
          >
            {T.changeModel}
          </Button>
          {copy.buyLink ? (
            <Button block icon={ExternalLink} onPress={() => void openLink(LINKS.pricing)} risk="paid" testid="m-price-plans">
              {T.plans}
            </Button>
          ) : null}
          <Button variant="quiet" block onPress={close} testid="m-price-close" el="G13.2">
            {T.close}
          </Button>
        </div>
      }
    >
      <Block lead testid="m-price-text">
        <div data-testid="m-price-kind" data-kind={view.kind} className="m-stackv" style={{ gap: 'var(--m-s2)' }}>
          {/* The name the chat shows for the model, not its id (small iPhone, K11: "openai::Qwen3.5-2B-Q4_K_M"). */}
          {model ? <strong style={{ overflowWrap: 'anywhere' }} data-testid="m-price-model">{chatModelLabel(models, model.name)}</strong> : null}
          {lines.map((line) => (
            <Hint key={line} strong>
              {line}
            </Hint>
          ))}
          {/* The mark "Direct" of a store build with its sentence spelled out: this sheet is the detail of the model. */}
          {model && chatModelDirect(models, model.name) ? (
            <div className="m-stackv" style={{ gap: 'var(--m-s1)' }} data-testid="m-price-direct">
              <span>
                <Tag>{DIRECT_MARK}</Tag>
              </span>
              <Hint>{DIRECT_SENTENCE}</Hint>
            </div>
          ) : null}
          {copy.hint ? <Hint testid="m-price-plans-text">{copy.hint}</Hint> : null}
        </div>
      </Block>
    </Sheet>
  )
}
