import type React from "react"
import { Editor } from "@sugar-high/react"
import { cn } from "@/lib/utils"

// sugar-high has no canonical "properties" (dotenv KEY=VALUE) language;
// "shell" tokenizes KEY / = / value into distinct colors close enough for
// the API-keys batch editor's one-key=value-per-line format.
const SUGAR_HIGH_LANG = { json: "json", properties: "shell" } as const

export const JsonEditor: React.FC<{
  value: string
  onChange: (value: string) => void
  className?: string
  language?: "json" | "properties"
  /** Rows of monospace text (20px line-height + 12px top/bottom padding) to size
   *  the editor to — e.g. the API-keys batch editor, which only ever holds a
   *  handful of key=value lines and doesn't need the 400px JSON-editing default. */
  rows?: number
}> = ({ value, onChange, className, language = "json", rows }) => {
  // A fixed height, not minHeight: <Editor>'s highlighted <Code> layer grows
  // to fit all its lines (unlike a plain <textarea>), so a min-height alone
  // never overflows and its internal `overflow-y: scroll` never kicks in —
  // long JSON just grows the box instead of scrolling inside it.
  const height = rows ? `${rows * 20 + 24}px` : "400px"

  return (
    <Editor
      lang={SUGAR_HIGH_LANG[language]}
      value={value}
      onChange={onChange}
      controls={false}
      lineNumbers={false}
      padding="0.75rem"
      fontSize="0.75rem"
      fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      className={cn("sh-theme w-full border rounded-md bg-background", className)}
      style={{ height }}
    />
  )
}
