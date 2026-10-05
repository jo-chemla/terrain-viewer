// Remotion's bundler: the "@/" alias the Remocn components are written
// against (components.json), resolved to src/.
import path from "node:path"
import { Config } from "@remotion/cli/config"

Config.setVideoImageFormat("jpeg")
// The shader backdrops (Remocn, @paper-design/shaders) need WebGL in the headless renderer.
Config.setChromiumOpenGlRenderer("angle")
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: { ...config.resolve, alias: { ...(config.resolve?.alias ?? {}), "@": path.join(process.cwd(), "src") } },
}))
