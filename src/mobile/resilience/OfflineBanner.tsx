/**
 * G7 the offline line. Owned by strand 6 (Remote and resilience).
 *
 * A slim line under the header of every page that needs the network
 * (<Page needsNetwork>, all of them pages of LU Cloud). It shows when the
 * phone has no network, and with Cloud switched on also when LU Cloud does
 * not answer (resilience/useOnline.ts). It goes away by itself as soon as an
 * answer comes back; nothing has to be tapped.
 *
 *   - **G7 Offline-Zeile.** Schmale Zeile unter der Kopfzeile jeder Seite, die Netz braucht: "No internet.
 *     On device models still work." Verschwindet von selbst.
 */
import { COMMON } from '../strings/common'
import { Banner, OfflineIcon } from '../ui'
import { useCloudOnline } from './useOnline'

export function OfflineBanner() {
  const online = useCloudOnline()
  if (online) return null
  return (
    <Banner variant="warn" icon={OfflineIcon} testid="m-app-offline" el="G7">
      {COMMON.offline}
    </Banner>
  )
}
