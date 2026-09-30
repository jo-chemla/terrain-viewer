import { useMemo } from "react"
import { Combobox } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// A searchable picker for a terrain source, for the nDSM modal's two operands:
// with fifty sources in the library a plain Select meant scrolling through
// every one, where typing "lidar hd" finds it. Base UI's Combobox filters the
// items by their label as you type; the value is the source id.

type Item = { value: string; label: string }

export function SourceCombobox({ id, value, onChange, options, placeholder = "Type to search…" }: {
  id: string
  value: string
  onChange: (id: string) => void
  options: { id: string; name: string }[]
  placeholder?: string
}) {
  const items = useMemo<Item[]>(() => options.map((o) => ({ value: o.id, label: o.name })), [options])
  const selected = items.find((i) => i.value === value) ?? null
  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(v) => onChange((v as Item | null)?.value ?? "")}
      itemToStringLabel={(i) => (i as Item).label}
    >
      <div className="relative flex w-full min-w-0 items-center">
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          className={cn(
            "border-input dark:bg-input/30 placeholder:text-muted-foreground h-9 w-full min-w-0 rounded-md border bg-transparent py-1 pl-3 pr-14 text-sm shadow-xs outline-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] cursor-text",
          )}
        />
        <div className="absolute right-1 flex items-center gap-0.5">
          {selected ? (
            <Combobox.Clear aria-label="Clear" className="cursor-pointer rounded-sm p-1 text-muted-foreground hover:text-foreground">
              <XIcon className="size-3.5" />
            </Combobox.Clear>
          ) : null}
          <Combobox.Trigger aria-label="Open the list" className="cursor-pointer rounded-sm p-1 text-muted-foreground hover:text-foreground">
            <ChevronDownIcon className="size-4 opacity-70" />
          </Combobox.Trigger>
        </div>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-[60] w-[var(--anchor-width)] max-w-[calc(100vw-2rem)]">
          <Combobox.Popup className="bg-popover text-popover-foreground max-h-72 overflow-y-auto rounded-md border p-1 shadow-md outline-none">
            <Combobox.Empty className="px-2 py-1.5 text-sm text-muted-foreground">No source matches.</Combobox.Empty>
            <Combobox.List>
              {(item: Item) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="truncate">{item.label}</span>
                  <Combobox.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
