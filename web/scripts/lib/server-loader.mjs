// Loads the app's server code outside Next for a test (20 Nov): `@/…` imports resolve to the web
// folder, extensionless relative imports find their .ts file, and `server-only` (Next's guard that a
// module never reaches a browser bundle) is an empty module — there is no browser here.
//   node --experimental-transform-types --no-warnings --import ./scripts/lib/server-loader.mjs <test>
import { register } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

if (!globalThis.__pandoServerLoader) {
  globalThis.__pandoServerLoader = true;
  register(import.meta.url, { data: { root: path.resolve(fileURLToPath(new URL("../..", import.meta.url))) } });
}

let root = "";
export function initialize(data) {
  root = data?.root ?? root;
}

const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];
function find(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const hit = find(path.join(root, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const hit = find(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    /* A package path without an "exports" map and without an extension (next/server, next/headers). */
    if (err?.code === "ERR_MODULE_NOT_FOUND" && !specifier.startsWith(".") && !/\.[cm]?js$/.test(specifier)) return next(`${specifier}.js`, context);
    throw err;
  }
}
