import fs from 'node:fs';
import path from 'node:path';
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]); }
const traces=walk('.next/server/app').filter(f=>f.endsWith('.nft.json'));
const union=new Set(); const results=[];
for(const trace of traces) {
  const files=JSON.parse(fs.readFileSync(trace,'utf8')).files.map(f=>path.resolve(path.dirname(trace),f));
  files.push(path.resolve(trace.replace(/\.nft\.json$/,'')));
  const unique=[...new Set(files)].filter(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
  unique.forEach(f=>union.add(f));
  const bytes=unique.reduce((sum,f)=>sum+fs.statSync(f).size,0);
  const forbidden=unique.filter(f=>/[\\/]@electric-sql[\\/]|[\\/]data[\\/](?:modelos|staging|storage|pglite)[\\/]|[\\/]\.env/.test(f));
  if(forbidden.length) throw new Error('Traza contiene archivos privados o locales: '+trace);
  results.push({route:trace,bytes,MB:bytes/1e6,within250MB:bytes<250_000_000});
}
const unionBytes=[...union].reduce((sum,f)=>sum+fs.statSync(f).size,0);
const report={createdAt:new Date().toISOString(),platform:process.platform,routes:results.sort((a,b)=>b.bytes-a.bytes),unionBytes,unionMB:unionBytes/1e6,
  note:'Archivos trazados sin comprimir. Incluye ONNX linux/x64; excluye modelos (descarga a /tmp), PGlite y datos. El empaquetado final de Vercel debe confirmar este tamaño en Linux.'};
fs.mkdirSync('data/verificacion',{recursive:true});
fs.writeFileSync('data/verificacion/funciones.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({largest:report.routes[0],unionMB:report.unionMB,routes:results.length},null,2));
if(results.some(r=>!r.within250MB)||unionBytes>=250_000_000)process.exitCode=1;
