import { readFile, mkdir, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const core = await readFile(new URL("src/core.js", root), "utf8");
const component = await readFile(new URL("src/card.js", root), "utf8");
const source = component.replace(/^import .+ from "\.\/core\.js";\r?\n/m, "");
if (source === component) throw new Error("Core import not found; refusing incomplete build");
await mkdir(new URL("dist/", root), { recursive: true });
await writeFile(new URL("dist/thermal-monitor-card.js", root), `// Thermal Monitor Card · MIT\n${core}\n${source}`, "utf8");
console.log("Built dist/thermal-monitor-card.js (no runtime dependencies)");
