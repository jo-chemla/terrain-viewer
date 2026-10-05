// Copies the clips recorded by record.sh into public/, scaled to 1920×1080
// at 30 fps (agent-browser records the 1600×900 viewport), and writes their
// lengths in frames to public/clips.json for the composition.
import { execFileSync } from "node:child_process"
import { writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const src = process.argv[2] ?? join(root, "recordings")
const frames = {}
for (const name of ["paper", "isoline"]) {
  const input = join(src, `clip-${name}.mp4`)
  if (!existsSync(input)) throw new Error(`missing ${input}`)
  const output = join(root, "public", `clip-${name}.mp4`)
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", "scale=1920:1080:flags=lanczos,fps=30", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", output])
  const n = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", output]).toString().trim()
  frames[`${name}Frames`] = Number(n)
}
writeFileSync(join(root, "public", "clips.json"), JSON.stringify(frames, null, 2) + "\n")
console.log(frames)
