import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import "./globals.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Terrain Viewer - 3D Terrain Comparison",
  description: "Compare different terrain sources with various visualization modes",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.11.0/dist/maplibre-gl.css" />
        <script src="https://unpkg.com/maplibre-gl@5.11.0/dist/maplibre-gl.js"></script>
      </head>
      <body className={`font-sans antialiased`}>
        <NuqsAdapter>{children}</NuqsAdapter>
        <Analytics />
      </body>
    </html>
  )
}
