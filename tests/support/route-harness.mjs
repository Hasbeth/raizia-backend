import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("../../src/rutas/", import.meta.url);

// Evalúa los handlers reales con adaptadores explícitos; nunca importa SQLite ni .env.local.
export function routeHarness({ documents = {}, auth = {}, rag = {}, tools = {} } = {}) {
  const strict = (adapter) => new Proxy(adapter, {
    get(target, key) {
      if (!(key in target)) throw new Error(`Dependencia inesperada: ${String(key)}`);
      return target[key];
    },
  });
  const adapters = { "@/lib/documents": strict(documents), "@/lib/auth": strict(auth), "@/lib/rag": strict(rag), "@/lib/tools-config": strict(tools) };
  return (name) => {
    const path = fileURLToPath(new URL(`${name}/route.ts`, root));
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loadedModule = { exports: {} };
    const isolatedRequire = (specifier) => {
      if (!(specifier in adapters)) throw new Error(`Import inesperado: ${specifier}`);
      return adapters[specifier];
    };
    new Function("require", "module", "exports", code)(isolatedRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  };
}
