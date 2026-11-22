import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as sourcePolicy from '../../src/lib/source-policy.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');

export function moduleHarness(path, adapters) {
  adapters = { './source-policy': sourcePolicy, ...adapters };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', code)(specifier => {
    if (!(specifier in adapters)) throw new Error(`Dependencia inesperada: ${specifier}`);
    return adapters[specifier];
  }, loaded, loaded.exports);
  return loaded.exports;
}
