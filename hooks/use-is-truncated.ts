import { useLayoutEffect, useRef, useState } from "react"

/** Ref + flag for "is this element's text currently clipped by CSS
 *  `truncate`/`overflow:hidden`" — re-measured on every render (cheap: one
 *  scrollWidth/clientWidth read on a small text node) plus on window resize,
 *  so a sidebar reflow or a renamed-to-longer value both update it. Used to
 *  only show a name tooltip when the name is actually cut off. */
export function useIsTruncated<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (el) setIsTruncated(el.scrollWidth > el.clientWidth)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  })

  return [ref, isTruncated] as const
}
