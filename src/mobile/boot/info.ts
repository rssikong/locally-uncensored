/** What the start hands to MobileRoot. In its own file so MobileRoot does not import the start that imports it. */
export interface BootInfo {
  /** The restore after a storage loss failed; the shell tells the user once. */
  restoreFailed: boolean
  /** iOS owns no system back gesture, so the shell provides the edge swipe. */
  edgeSwipe: boolean
}
