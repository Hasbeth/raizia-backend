import fs from 'node:fs';
import path from 'node:path';

// Copia explícita de código, nunca archivos de entorno, datos ni repositorios vecinos.
const root = process.cwd();
if (!['raizia-backend', 'raizia-frontend'].includes(path.basename(root))) throw new Error('Usar dentro de un repositorio RAIZIA');
const verification = path.join(root, '.verification');
fs.mkdirSync(verification, { recursive: true });
const target = fs.mkdtempSync(path.join(verification, 'build-'));
for (const name of ['src', 'public', 'scripts', 'supabase', 'next.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts']) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(target, name), { recursive: true });
}
fs.symlinkSync(path.join(root, 'node_modules'), path.join(target, 'node_modules'), 'junction');
// Turbopack necesita abarcar el node_modules original enlazado; el proyecto es la copia.
fs.appendFileSync(path.join(target, 'next.config.ts'), `\nnextConfig.turbopack = { ...nextConfig.turbopack, root: ${JSON.stringify(root)} };\n`);
console.log(target);
