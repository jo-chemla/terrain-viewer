import path from "node:path";
import { createGenerator } from "fumadocs-typescript";
import { AutoTypeTable } from "fumadocs-typescript/ui";

// The ProjectConfig interface (lib/project-config.ts) rendered as a type
// table straight from the source, JSDoc included - so the docs cannot drift
// from what the app actually reads. Resolved against the main app's own
// tsconfig, since the interface imports the BYOD source types.
const generator = createGenerator({ tsconfigPath: path.resolve(process.cwd(), "../tsconfig.json") });

export function ProjectConfigTable() {
  return (
    <AutoTypeTable
      generator={generator}
      path={path.resolve(process.cwd(), "../lib/project-config.ts")}
      name="ProjectConfig"
    />
  );
}
