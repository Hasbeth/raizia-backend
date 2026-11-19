import { registerHooks } from "node:module";
import { extname } from "node:path";

// Solo el proceso de pruebas resuelve los imports sin extensión y el alias de TS.
// Node 26 elimina los tipos del código original; no copiamos su implementación.
const sourceRoot = new URL("../../src/", import.meta.url);
const database = new URL("lib/db.ts", sourceRoot).href;
const databaseStub = new URL("./db-stub.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "node:sqlite") {
      throw new Error("Las pruebas de lógica pura no pueden cargar SQLite.");
    }

    let target;
    if (specifier.startsWith("@/")) {
      target = new URL(specifier.slice(2), sourceRoot);
    } else if (specifier.startsWith(".") && context.parentURL) {
      target = new URL(specifier, context.parentURL);
    } else if (specifier.startsWith("file:")) {
      target = new URL(specifier);
    }

    if (target?.href.startsWith(sourceRoot.href)) {
      if (!extname(target.pathname)) target.pathname += ".ts";
      // Se intercepta antes de evaluar db.ts, aunque su apertura actual sea diferida.
      if (target.href === database) return nextResolve(databaseStub, context);
      return nextResolve(target.href, context);
    }
    return nextResolve(specifier, context);
  },
});
