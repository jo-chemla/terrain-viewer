
// --- LAYERS COMPONENT ---

import { HexAlphaColorPicker, HexColorInput } from "react-colorful";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "@/lib/utils";

// A color swatch that opens a popover with an alpha-aware picker. Native
// <input type="color"> can't carry an alpha channel at all (browsers strip
// it), and shadcn/ui doesn't ship a color picker of its own — the common
// pattern is react-colorful's HexAlphaColorPicker inside a Popover, which is
// what this pairs with the project's own Popover primitive.
export function ColorAlphaSwatch({
    color, onChange, title, className, size = "h-6 w-6",
}: {
    color: string; onChange: (hex: string) => void; title: string; className?: string
    /** Tailwind height/width utility pair — defaults to "h-6 w-6" (this
     *  component's original size). Pass e.g. "h-7 w-7" to match an adjacent
     *  control's height (like CycleButtonGroup's chevron buttons) instead of
     *  fighting `className` over which sizing utility wins. */
    size?: string
}) {
    return (
        <Popover>
            <PopoverTrigger
                render={
                    <button
                        type="button"
                        title={title}
                        className={cn(size, "shrink-0 p-0 m-0 border cursor-pointer", className)}
                        style={{
                            // Two stacked background layers: the layer's own (possibly
                            // semi-transparent) color on top of a checkerboard, so partial
                            // alpha is visible on the swatch itself rather than just
                            // blending invisibly into the sidebar background.
                            backgroundImage: `linear-gradient(${color}, ${color}), repeating-conic-gradient(#80808080 0% 25%, transparent 0% 50%)`,
                            backgroundSize: 'auto, 8px 8px',
                        }}
                    />
                }
            />
            <PopoverContent className="w-auto p-3 space-y-2">
                <HexAlphaColorPicker color={color} onChange={onChange} />
                <HexColorInput
                    color={color}
                    onChange={onChange}
                    alpha
                    prefixed
                    className="flex h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                />
            </PopoverContent>
        </Popover>
    )
}