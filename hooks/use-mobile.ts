import * as React from 'react'

// 640 — matched to Tailwind's `sm:` breakpoint, because every mobile/desktop
// CSS split in the app (sidebar w-80 vs sm:w-96, timeline panel docked vs
// floating) flips at `sm:`. This hook used to say 768, leaving a 640-767px
// band where the JS layout math (sidebar footprint, timeline right offset)
// ran in "mobile" mode while the CSS was already rendering the desktop
// layout — e.g. the timeline panel slid under the open sidebar there.
const MOBILE_BREAKPOINT = 640

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
