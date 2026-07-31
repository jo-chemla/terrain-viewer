'use client'

import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// Down/Up arrow already opens the popup and navigates it (standard listbox
// a11y behavior, kept as-is) — Left/Right instead cycle the trigger's value
// directly without opening anything, like a native OS-style stepper. Base UI
// doesn't expose its internal item registry publicly, so the ordered value
// list is derived from whichever the caller already provides: the `items`
// prop when given (Record, {value,label}[], or grouped `{items:[...]}[]`),
// otherwise by walking the static `<SelectItem>`/`<SelectGroup>` children —
// both available synchronously as plain React elements even while the popup
// itself is unmounted, so this works whether or not the select is open.
type SelectItemsInput = SelectPrimitive.Root.Props<unknown>['items']

interface SelectCycleEntry {
  value: unknown
  disabled?: boolean
}

function collectFromItemsProp(items: SelectItemsInput): SelectCycleEntry[] {
  if (!items) return []
  if (Array.isArray(items)) {
    return items.flatMap((entry): SelectCycleEntry[] => {
      if (entry && typeof entry === 'object' && 'items' in entry && Array.isArray((entry as { items: unknown }).items)) {
        return (entry as { items: ReadonlyArray<{ value: unknown; disabled?: boolean }> }).items.map((i) => ({ value: i.value, disabled: i.disabled }))
      }
      return [{ value: (entry as { value: unknown }).value, disabled: (entry as { disabled?: boolean }).disabled }]
    })
  }
  // Record<string, ReactNode>
  return Object.keys(items as Record<string, React.ReactNode>).map((value) => ({ value }))
}

function collectFromChildren(children: React.ReactNode): SelectCycleEntry[] {
  const entries: SelectCycleEntry[] = []
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const props = child.props as { value?: unknown; disabled?: boolean; children?: React.ReactNode }
    if (child.type === SelectItem) {
      entries.push({ value: props.value, disabled: props.disabled })
    } else if (child.type === SelectGroup || child.type === SelectContent || child.type === React.Fragment) {
      entries.push(...collectFromChildren(props.children))
    }
  })
  return entries
}

const SelectCycleContext = React.createContext<{
  entries: SelectCycleEntry[]
  value: unknown
  onValueChange?: (value: unknown, eventDetails: unknown) => void
} | null>(null)

function Select<Value = string>({
  items,
  value,
  onValueChange,
  children,
  ...props
}: SelectPrimitive.Root.Props<Value>) {
  const entries = React.useMemo(
    () => (items ? collectFromItemsProp(items as SelectItemsInput) : collectFromChildren(children)),
    [items, children],
  )

  return (
    <SelectCycleContext.Provider value={{ entries, value, onValueChange: onValueChange as (value: unknown, eventDetails: unknown) => void }}>
      <SelectPrimitive.Root data-slot="select" items={items} value={value} onValueChange={onValueChange} {...props}>
        {children}
      </SelectPrimitive.Root>
    </SelectCycleContext.Provider>
  )
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  const cycle = React.useContext(SelectCycleContext)

  const handleKeyDown = React.useCallback(
    (event: Parameters<NonNullable<typeof onKeyDown>>[0]) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      // Popup already open: leave arrow keys to the listbox's own
      // up/down + typeahead navigation, untouched.
      if (event.currentTarget.hasAttribute('data-popup-open')) return
      if (!cycle || cycle.entries.length === 0) return

      const direction = event.key === 'ArrowRight' ? 1 : -1
      const currentIndex = cycle.entries.findIndex((entry) => Object.is(entry.value, cycle.value))
      let nextIndex = currentIndex === -1 ? (direction === 1 ? 0 : cycle.entries.length - 1) : currentIndex + direction
      // Skip disabled entries in the chosen direction; clamp at the ends
      // rather than wrapping, matching a native <select>'s own arrow-key feel.
      while (nextIndex >= 0 && nextIndex < cycle.entries.length && cycle.entries[nextIndex].disabled) {
        nextIndex += direction
      }
      if (nextIndex < 0 || nextIndex >= cycle.entries.length || nextIndex === currentIndex) return

      event.preventDefault()
      cycle.onValueChange?.(cycle.entries[nextIndex].value, { reason: 'none' })
    },
    [onKeyDown, cycle],
  )

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      onKeyDown={handleKeyDown}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<ChevronDownIcon className="size-4 opacity-50" />} />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side,
  sideOffset,
  align = 'start',
  alignOffset,
  alignItemWithTrigger = false,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    'side' | 'sideOffset' | 'align' | 'alignOffset' | 'alignItemWithTrigger'
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className={cn(
          'z-50 min-w-[8rem]',
          !alignItemWithTrigger &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        )}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'bg-popover text-popover-foreground relative max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md transition-[transform,opacity] data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0',
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List
            className={cn(
              'p-1',
              !alignItemWithTrigger && 'w-full min-w-(--anchor-width) scroll-my-1',
            )}
          >
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('text-muted-foreground px-2 py-1.5 text-xs', className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        'flex cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        'flex cursor-default items-center justify-center py-1',
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
