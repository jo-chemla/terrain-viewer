import type React from "react"
import { useState } from "react"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Light as SyntaxHighlighter } from "react-syntax-highlighter"
import xml from "react-syntax-highlighter/dist/esm/languages/hljs/xml"
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash"
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs"
import { copyToClipboard } from "@/lib/controls-utils"

SyntaxHighlighter.registerLanguage("xml", xml)
SyntaxHighlighter.registerLanguage("bash", bash)

export const GdalTabs: React.FC<{
  tileUrl: string
  wmsXml: string
  gdalCommand: string
}> = ({ tileUrl, wmsXml, gdalCommand }) => {
  const [activeTab, setActiveTab] = useState("url")

  const handleCopy = () => {
    if (activeTab === "url") copyToClipboard(tileUrl)
    else if (activeTab === "xml") copyToClipboard(wmsXml)
    else copyToClipboard(gdalCommand)
  }

  return (
    <Tabs
      defaultValue="url"
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full"
    >
      <div className="bg-muted/60 dark:bg-zinc-900 rounded-lg overflow-hidden border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <TabsList className="bg-transparent p-0 space-x-1">
            <TabsTrigger
              value="url"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground cursor-pointer rounded-md"
            >
              URL Template
            </TabsTrigger>
            <TabsTrigger
              value="xml"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground cursor-pointer rounded-md"
            >
              GDAL_WMS XML
            </TabsTrigger>
            <TabsTrigger
              value="cmd"
              className="px-3 py-1 text-xs font-medium text-muted-foreground data-[state=active]:text-foreground data-[state=inactive]:text-muted-foreground cursor-pointer rounded-md"
            >
              gdal_translate
            </TabsTrigger>
          </TabsList>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleCopy}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{
                activeTab === "url"
                  ? "Copy TMS URL template"
                  : activeTab === "xml"
                    ? "Copy GDAL_WMS XML"
                    : "Copy gdal_translate command"
              }</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="max-h-64 overflow-auto">
          <TabsContent value="url" className="p-3 pt-2 text-xs font-mono">
            <SyntaxHighlighter
              language="bash"
              style={atomOneDark}
              customStyle={{
                background: "transparent",
                fontSize: "0.75rem",
                margin: 0,
                padding: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              wrapLongLines
            >
              {tileUrl}
            </SyntaxHighlighter>
          </TabsContent>

          <TabsContent value="xml" className="p-3 pt-2 text-xs font-mono">
            <SyntaxHighlighter
              language="xml"
              style={atomOneDark}
              customStyle={{
                background: "transparent",
                fontSize: "0.75rem",
                margin: 0,
                padding: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              wrapLongLines
            >
              {wmsXml}
            </SyntaxHighlighter>
          </TabsContent>

          <TabsContent value="cmd" className="p-3 pt-2 text-xs font-mono">
            <SyntaxHighlighter
              language="bash"
              style={atomOneDark}
              customStyle={{
                background: "transparent",
                fontSize: "0.75rem",
                margin: 0,
                padding: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              wrapLongLines
            >
              {gdalCommand}
            </SyntaxHighlighter>
          </TabsContent>
        </div>
      </div>
    </Tabs>
  )
}
