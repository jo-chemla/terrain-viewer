import { useEffect, useState } from "react"

/** Returns `value`, but only after it's stopped changing for `delayMs` —
 *  same idea as lib/wayback.ts's own inline debounce, generalized for any
 *  value. Used to keep expensive downstream work (e.g. reloading a raster
 *  tile source) from re-firing on every intermediate value while a
 *  continuous gesture (dragging a timeline handle across many ticks) is
 *  still in progress. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
