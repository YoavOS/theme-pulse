// Theme Pulse: rebuild the website whenever the app's files change, so a normal page refresh shows updates.
// Started by Start Theme Pulse (as the "watch" service) and stopped by Stop Theme Pulse. Runs at low priority.
// It only rebuilds; it never deletes your data. Old page files stay until the next full start, so open tabs keep working.
import { watch, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const { build } = await import(pathToFileURL(path.join(root, "node_modules", "vite", "dist", "node", "index.js")).href);

const WAIT_MS = 3000;           // wait for a batch of file copies to finish
let timer = null, building = false, again = false;
const log = (m) => console.log(`${new Date().toLocaleTimeString("en-GB")}  ${m}`);

async function rebuild() {
  if (building) { again = true; return; }
  building = true; again = false;
  const t0 = Date.now();
  log("Change detected - rebuilding the website...");
  try {
    await build({ root, logLevel: "warn", build: { emptyOutDir: false } });
    log(`Updated in ${Math.round((Date.now() - t0) / 1000)} s - refresh the page to see it.`);
  } catch (e) {
    log(`Build failed - the previous version stays live. ${String(e?.message ?? e).split("\n")[0]}`);
  }
  building = false;
  if (again) schedule();
}
function schedule() { clearTimeout(timer); timer = setTimeout(rebuild, WAIT_MS); }

const targets = ["src", "public", "index.html", "vite.config.ts", "tailwind.config.ts"].map((p) => path.join(root, p)).filter(existsSync);
for (const t of targets) {
  watch(t, { recursive: true }, (_ev, file) => {
    if (file && /(~|\.tmp|\.swp)$/.test(String(file))) return;
    schedule();
  });
}
log(`Watching ${targets.map((t) => path.relative(root, t)).join(", ")} for changes.`);
