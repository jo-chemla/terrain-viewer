import type React from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { LucideIcon } from "lucide-react"

interface TooltipButtonProps {
    icon: LucideIcon
    label: string
    tooltip: string
    onClick: () => void
    className?: string
}

export const TooltipButton: React.FC<TooltipButtonProps> = ({
    icon: Icon,
    label,
    tooltip,
    onClick,
    className = "flex-1"
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={`cursor-pointer bg-transparent ${className}`}
                    onClick={onClick}
                >
                    <Icon className="h-3 w-3 mr-2" />
                    {label}
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                <p>{tooltip}</p>
            </TooltipContent>
        </Tooltip>
    )
}


interface TooltipIconButtonProps {
    icon: LucideIcon
    tooltip: string
    onClick?: () => void
    className?: string
    variant?: React.ComponentProps<typeof Button>["variant"]
    size?: React.ComponentProps<typeof Button>["size"]
}

export const TooltipIconButton: React.FC<TooltipIconButtonProps> = ({
    icon: Icon,
    tooltip,
    onClick,
    className = "",
    variant = "ghost",
    size = "icon",
}) => {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={variant}
                    size={size}
                    onClick={onClick}
                    className={`cursor-pointer ${className}`}
                >
                    <Icon className="h-4 w-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                <p>{tooltip}</p>
            </TooltipContent>
        </Tooltip>
    )
}