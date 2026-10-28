import { createContext, useContext } from 'react'

/** Lets a scenario hide the dev HUD, e.g. for a screen recording. */
export const HudVisibilityContext = createContext<(hidden: boolean) => void>(
  () => {}
)

export function useSetHudHidden(): (hidden: boolean) => void {
  return useContext(HudVisibilityContext)
}
