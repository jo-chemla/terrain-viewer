let locked = false

export const lockNuqsUrl = () => { locked = true }
export const unlockNuqsUrl = () => { locked = false }
export const isNuqsLocked = () => locked