/// <reference types="vite/client" />

// Fallback in case the installed vite/client.d.ts doesn't cover this specific
// suffix — see lib/changelog.ts's `?raw` import of CHANGELOG.md. Ambient
// module declarations merge safely if vite/client.d.ts already declares it.
declare module "*.md?raw" {
  const content: string
  export default content
}
