// Prueba qué servidor de conexión (pooler) de Supabase responde con la contraseña dada.
// Uso: node scripts/probar-conexion.mjs <ref> <contraseña>  (no imprime la contraseña)
import postgres from "postgres";

const [ref, password] = process.argv.slice(2);
for (const host of ["aws-0-sa-east-1.pooler.supabase.com", "aws-1-sa-east-1.pooler.supabase.com"]) {
  const url = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:6543/postgres`;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10, ssl: "require" });
  try {
    const [r] = await sql`select version() as v, current_database() as db`;
    console.log(`OK ${host}: ${r.v.split(" ").slice(0, 2).join(" ")} (${r.db})`);
    console.log(`URL=postgresql://postgres.${ref}:<CONTRASEÑA>@${host}:6543/postgres`);
    await sql.end();
    process.exit(0);
  } catch (e) {
    console.log(`falla ${host}: ${e.message}`);
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
process.exit(1);
