import { ChevronDown } from 'lucide-react'
import { cx, testProps, type Testable } from './common'
import { Icon } from './Icon'

export interface ModelChipProps extends Testable {
  /** Display name of the chosen model, or null when none is chosen. */
  name: string | null
  /** local: green dot. cloud: violet dot. */
  where: 'local' | 'cloud'
  onPress: () => void
  /** Text without a model, default "Choose a model". */
  emptyText?: string
  disabled?: boolean
}

/** Pure: the accessible name. "Model: Gemma 3 4B. Change model" (DESIGN.md C2.6). */
export function modelChipName(name: string | null, emptyText = 'Choose a model'): string {
  return name ? `Model: ${name}. Change model` : emptyText
}

/** The model choice in the composer, with a dot for on device or cloud. */
export function ModelChip(props: ModelChipProps) {
  const { name, where, onPress, emptyText = 'Choose a model', disabled } = props
  return (
    <button
      type="button"
      className={cx('m-mchip', name ? where === 'cloud' && 'm-mchip--cloud' : 'm-mchip--none')}
      aria-label={modelChipName(name, emptyText)}
      disabled={disabled}
      onClick={onPress}
      {...testProps(props)}
    >
      <i aria-hidden="true" />
      <span className="m-mchip-name">{name ?? emptyText}</span>
      <Icon icon={ChevronDown} small />
    </button>
  )
}
