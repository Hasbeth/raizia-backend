// Lectura exclusiva de staging. No consulta red ni carga archivos de entorno.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const db = new DatabaseSync(new URL('../data/staging/biblioteca.db', import.meta.url), { readOnly: true });
db.exec('PRAGMA query_only=ON');
const citations = [
  [23, 35, 'Constitución, artículo 23', ['ARTÍCULO 23', 'peticiones respetuosas']],
  [23, 173, 'Constitución, artículo 86', ['ARTÍCULO 86', 'derechos constitucionales fundamentales']],
  [23, 175, 'Constitución, artículo 87', ['ARTÍCULO 87', 'cumplimiento de una ley']],
  [23, 176, 'Constitución, artículo 88', ['ARTÍCULO 88', 'acciones populares']],
  [25, 1058, 'Ley 1755/2015, artículo 14', ['quince (15)', 'diez (10)', 'treinta (30)']],
  [24, 1013, 'Convenio 169, artículo 6 (Ley 21/1991)', ['ARTICULO 6', 'Consultar a los pueblos']],
  [26, 1096, 'Decreto 2591/1991, artículo 7', ['7-Medidas provisionales', 'necesario y urgente']],
  [26, 1099, 'Decreto 2591/1991, artículo 10', ['10.-Legitimidad', 'agenciar derechos ajenos']],
  [26, 1115, 'Decreto 2591/1991, artículo 27', ['ARTICULO 27', 'mantendrá la competencia']],
  [26, 1117, 'Decreto 2591/1991, artículo 29', ['ARTICULO 29', 'diez días siguientes']],
  [26, 1119, 'Decreto 2591/1991, artículo 31', ['ARTICULO 31', 'tres días siguientes a su notificación']],
  [26, 1126, 'Decreto 2591/1991, artículo 37', ['ARTICULO 37', 'gravedad del juramento']],
  [26, 1141, 'Decreto 2591/1991, artículo 52', ['52.-Desacato', 'trámite incidental']],
  [46, 3715, 'Ley 393/1997, artículo 8', ['Artículo 8', 'renuencia']],
  [46, 3717, 'Ley 393/1997, artículo 10', ['Artículo 10', 'gravedad del juramento']],
  [27, 1153, 'Ley 472/1998, artículo 4', ['ARTÍCULO 4', 'Derechos e Intereses Colectivos']],
  [27, 1221, 'Ley 472/1998, artículo 46', ['ARTÍCULO 46', 'veinte (20)']],
  [27, 1222, 'Ley 472/1998, artículo 47', ['ARTÍCULO 47', 'dos (2) años']],
  [27, 1224, 'Ley 472/1998, artículo 48', ['ARTÍCULO 48', 'Personeros']],
  [27, 1225, 'Ley 472/1998, artículo 49', ['ARTÍCULO 49', 'por conducto de abogado']],
  [50, 4255, 'Ley 1437/2011, artículo 144', ['ARTÍCULO 144', 'derechos e intereses colectivos']],
];
try {
  const report = citations.map(([documentId, chunkId, citation, fragments]) => {
    const row = db.prepare('SELECT d.title, d.status, c.content FROM documents d JOIN chunks c ON c.document_id=d.id WHERE d.id=? AND c.id=?').get(documentId, chunkId);
    if (!row || row.status !== 'aprobado' || fragments.some(text => !row.content.includes(text))) throw new Error(`No se pudo verificar: ${citation} (${chunkId})`);
    return { citation, documentId, chunkId, title: row.title, sha256: createHash('sha256').update(row.content).digest('hex') };
  });
  writeFileSync(new URL('../tests/tools-legal-verification.json', import.meta.url), JSON.stringify({ source: 'data/staging/biblioteca.db', readOnly: true, citations: report }, null, 2) + '\n');
  console.log(`${report.length} citas verificadas en staging, solo lectura. No se copió contenido de casos.`);
} finally { db.close(); }
