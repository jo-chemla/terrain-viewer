import type React from "react"
import { useRef } from "react"
import { Light as SyntaxHighlighter } from "react-syntax-highlighter"
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json"
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs"
import { cn } from "@/lib/utils"

SyntaxHighlighter.registerLanguage("json", json)

// Classic "transparent textarea over a highlighted <pre>" overlay: the textarea stays fully
// editable (real caret, selection, undo history) while a syntax-highlighted copy of the same
// text sits behind it. The two layers must share identical font metrics and padding or the
// highlighted text won't line up with what you're typing — scroll position is synced manually
// since they're two independent scrollable elements.
export const JsonEditor: React.FC<{
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}> = ({ value, onChange, className, placeholder }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)

  const syncScroll = () => {
    if (!textareaRef.current || !highlightRef.current) return
    highlightRef.current.scrollTop = textareaRef.current.scrollTop
    highlightRef.current.scrollLeft = textareaRef.current.scrollLeft
  }

  const sharedTextStyle: React.CSSProperties = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.75rem",
    lineHeight: "1.25rem",
    padding: "0.75rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    tabSize: 2,
  }

  return (
    <div className={cn("relative w-full min-h-[400px] border rounded-md overflow-hidden", className)}>
      <div
        ref={highlightRef}
        aria-hidden
        className="absolute inset-0 overflow-auto pointer-events-none bg-background"
        style={sharedTextStyle}
      >
        <SyntaxHighlighter
          language="json"
          style={atomOneDark}
          customStyle={{ background: "transparent", margin: 0, padding: 0, ...sharedTextStyle }}
          codeTagProps={{ style: { fontFamily: "inherit" } }}
        >
          {/* Trailing newline keeps the last line's height in sync with the textarea */}
          {value + "\n"}
        </SyntaxHighlighter>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="relative w-full h-full min-h-[400px] resize-none outline-none focus:ring-2 focus:ring-ring text-transparent caret-foreground bg-transparent"
        style={sharedTextStyle}
      />
    </div>
  )
}
