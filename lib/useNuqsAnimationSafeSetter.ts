import { useCallback } from "react"
import { isNuqsLocked } from "@/lib/nuqsSyncLock"

/**
 * Prevents URL writes while animation/export is running.
 * Still updates React UI state.
 */
export function useNuqsAnimationSafeSetter<T extends object>(
  nuqsSetter: (state: T, shallow?: boolean) => void,
  localSetter: (state: T) => void
) {
  return useCallback(
    (state: T, shallow?: boolean) => {
      if (isNuqsLocked()) {
        // update UI only — no URL sync
        localSetter(state)
        return
      }

      nuqsSetter(state, shallow)
    },
    [nuqsSetter, localSetter]
  )
}