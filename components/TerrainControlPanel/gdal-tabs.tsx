import type React from "react"
import { useState } from "react"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Code } from "@sugar-high/react"
import { copyToClipboard } from "@/lib/controls-utils"

export const GdalTabs: React.FC<{
  tileUrl: string
  wmsXml: string
  gdalCommand: string
  gdalDemCommand: string
  onTabChange?: (tab: string) => void
}> = ({ tileUrl, wmsXml, gdalCommand, gdalDemCommand, onTabChange }) => {
  const [activeTab, setActiveTab] = useState("url")

  const handleCopy = () => {
    if (activeTab === "url") copyToClipboard(tileUrl)
    else if (activeTab === "xml") copyToClipboard(wmsXml)
    else if (activeTab === "cmd") copyToClipboard(gdalCommand)
    else copyToClipboard(gdalDemCommand)
  }

  return (
    <Tabs
      defaultValue="url"
      value={activeTab}
      onValueChange={(tab) => { setActiveTab(tab); onTabChange?.(tab) }}
      className="w-full"
    >
      <div className="bg-muted/60 dark:bg-zinc-900 rounded-lg overflow-hidden border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <TabsList className="bg-transparent p-0 space-x-1">
            <TabsTrigger
              value="url"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-active:text-foreground cursor-pointer rounded-md"
            >
              URL Template
            </TabsTrigger>
            <TabsTrigger
              value="xml"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-active:text-foreground cursor-pointer rounded-md"
            >
              GDAL_WMS XML
            </TabsTrigger>
            <TabsTrigger
              value="cmd"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-active:text-foreground cursor-pointer rounded-md"
            >
              gdal_translate
            </TabsTrigger>
            <TabsTrigger
              value="gdaldem"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-active:text-foreground cursor-pointer rounded-md"
            >
              gdaldem
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={handleCopy}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              }
            />
            <TooltipContent>
              <p>{
                activeTab === "url"
                  ? "Copy TMS URL template"
                  : activeTab === "xml"
                    ? "Copy GDAL_WMS XML"
                    : activeTab === "cmd"
                      ? "Copy gdal_translate command"
                      : "Copy gdaldem commands"
              }</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="max-h-64 overflow-auto">
          <TabsContent value="url" className="p-3 pt-2 text-xs font-mono">
            <Code lang="shell" padding="0" className="sh-theme">
              {tileUrl}
            </Code>
          </TabsContent>

          <TabsContent value="xml" className="p-3 pt-2 text-xs font-mono">
            {/* sugar-high has no canonical "xml" language; "html" tokenizes
                tags/attributes close enough for this GDAL_WMS XML snippet. */}
            <Code lang="html" padding="0" className="sh-theme">
              {wmsXml}
            </Code>
          </TabsContent>

          <TabsContent value="cmd" className="p-3 pt-2 text-xs font-mono">
            <Code lang="shell" padding="0" className="sh-theme">
              {gdalCommand}
            </Code>
          </TabsContent>

          <TabsContent value="gdaldem" className="p-3 pt-2 text-xs font-mono">
            <Code lang="shell" padding="0" className="sh-theme">
              {gdalDemCommand}
            </Code>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}
