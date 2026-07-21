export type ColorTokenDef = { key: string; label: string; type: "color" }
export type LengthTokenDef = { key: string; label: string; type: "length"; unit: string; min: number; max: number; step: number }
export type FontTokenDef = { key: string; label: string; type: "font" }
export type ShadowTokenDef = { key: string; label: string; type: "shadow-color" | "shadow-opacity" | "shadow-length" | "shadow-offset"; min?: number; max?: number; step?: number }

export type TokenDef = ColorTokenDef | LengthTokenDef | FontTokenDef | ShadowTokenDef

export type TokenGroup = {
  id: string
  title: string
  tokens: TokenDef[]
  /** "color" groups (Primary, Secondary, ... Sidebar) render nested inside a
   *  single outer "Colors" fold in ThemeEditorPanel rather than each getting
   *  its own top-level one — otherwise "color", non-color groups (Radius &
   *  Spacing, Typography, Shadow) stay top-level. */
  category?: "color" | "other"
}
