/**
 * E4 Appearance. Route /settings/appearance, page, strand 5 (Account, cloud, settings).
 *
 * Theme, profile picture and whether Cloud features stay visible while the
 * app is on device. The text size is not a setting of LU: it follows the
 * phone, and the page says so.
 */
import { useState } from 'react'
import { ImagePlus, Trash2, UserRound } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { pickPhotos, setThemePref, type ThemePref } from '../../platform'
import { SETTINGS_STRINGS } from '../../strings/settings'
import { Button, Icon, ListGroup, Notice, Page, Row, Segmented, toast } from '../../ui'
import { fileToAvatar } from './parts/avatar'
import { useUserAvatar } from './parts/UserAvatar'
import { Block, Hint } from './parts/layout'
import { useMobilePrefs } from './parts/prefs'
import { useThemePref } from './parts/theme-pref'

const T = SETTINGS_STRINGS.appearance

const THEMES: ReadonlyArray<{ value: ThemePref; label: string; testid: string }> = [
  { value: 'system', label: T.system, testid: 'm-settings-appearance-theme-system' },
  { value: 'dark', label: T.dark, testid: 'm-settings-appearance-theme-dark' },
  { value: 'light', label: T.light, testid: 'm-settings-appearance-theme-light' },
]

export default function AppearancePage() {
  const theme = useThemePref()
  // Only a picture that can be drawn counts as "has one": what the cards show and what this page says stay the same.
  const avatar = useUserAvatar()
  const teasers = useSettingsStore((s) => s.settings.cloudTeasersEnabled !== false)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const hintShown = useMobilePrefs((s) => s.teaserHintShown)
  const setPref = useMobilePrefs((s) => s.setPref)
  const [busy, setBusy] = useState(false)
  const [showHint, setShowHint] = useState(false)

  const choosePhoto = async () => {
    if (busy) return
    const picked = await pickPhotos()
    const first = picked[0]
    if (!first) return
    setBusy(true)
    try {
      updateSettings({ userAvatarDataUrl: await fileToAvatar(first.file) })
      toast(T.pictureSet, { testid: 'avatar-set' })
    } catch {
      toast(T.pictureFailed, { tone: 'error', testid: 'avatar-failed' })
    } finally {
      setBusy(false)
    }
  }

  const setTeasers = (next: boolean) => {
    updateSettings({ cloudTeasersEnabled: next })
    if (!next && !hintShown) {
      // Said once, the first time it is switched off: where to find it again.
      setShowHint(true)
      setPref('teaserHintShown', true)
    }
    if (next) setShowHint(false)
  }

  return (
    <Page title={T.title} screen="settings-appearance">
      <Block lead>
        <Segmented<ThemePref> label={T.theme} options={THEMES} value={theme} onChange={setThemePref} testid="m-settings-appearance-theme" el="E4.1" />
        <Hint>{T.themeHint}</Hint>
        <Hint testid="m-settings-appearance-text-size">{T.textSize}</Hint>
      </Block>

      <ListGroup title={T.picture}>
        <div className="m-row" data-testid="m-settings-appearance-picture" data-has={avatar ? 'yes' : 'no'}>
          {avatar ? (
            <img src={avatar} alt="" width={44} height={44} style={{ borderRadius: '50%', objectFit: 'cover', flex: 'none' }} />
          ) : (
            <Icon icon={UserRound} />
          )}
          <span className="m-row-text">
            <span className="m-row-title">{T.picture}</span>
            <span className="m-row-sub">{T.pictureSub}</span>
          </span>
        </div>
      </ListGroup>
      <Block>
        <Button block icon={ImagePlus} busy={busy} onPress={() => void choosePhoto()} risk="sensor" testid="m-settings-appearance-picture-choose" el="E4.2">
          {avatar ? T.pictureChange : T.pictureChoose}
        </Button>
        {avatar ? (
          <Button
            variant="quiet"
            block
            icon={Trash2}
            onPress={() => {
              updateSettings({ userAvatarDataUrl: '' })
              toast(T.pictureRemoved, { testid: 'avatar-removed' })
            }}
            risk="destructive" testid="m-settings-appearance-picture-remove"
            el="E4.2"
          >
            {T.pictureRemove}
          </Button>
        ) : null}
      </Block>

      <ListGroup title={SETTINGS_STRINGS.cloud.title}>
        <Row
          title={T.cloudTeasers}
          subtitle={T.cloudTeasersSub}
          switch={{ checked: teasers, onChange: setTeasers, tone: 'cloud' }}
          testid="m-settings-appearance-cloud-teasers"
          el="E4.3"
        />
      </ListGroup>
      {showHint ? <Notice testid="m-settings-appearance-teasers-hint">{T.cloudTeasersHint}</Notice> : null}
    </Page>
  )
}
