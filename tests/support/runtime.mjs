import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const sourceRoot=new URL('../../src/',import.meta.url);
registerHooks({
 resolve(specifier,context,nextResolve) {
  let target;
  if(specifier.startsWith('@/')) target=new URL(specifier.slice(2),sourceRoot);
  else if(specifier.startsWith('.')&&context.parentURL) target=new URL(specifier,context.parentURL);
  if(target?.href.startsWith(sourceRoot.href)) {
   if(!extname(target.pathname))target.pathname+='.ts';
   return nextResolve(target.href,context);
  }
  return nextResolve(specifier,context);
 },
 load(url,context,nextLoad) {
  // Node strip-types no soporta parameter properties de las rutas heredadas.
  if(url.startsWith(sourceRoot.href)&&url.endsWith('.ts')) {
   return {format:'module',source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};
  }
  return nextLoad(url,context);
 }
});
