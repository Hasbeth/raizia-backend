export async function measureSpace(database) {
  const [size] = await database.query('SELECT pg_database_size(current_database())::bigint bytes');
  const [objects] = await database.query('SELECT COALESCE(sum(bytes),0)::bigint bytes,count(*)::int objects FROM storage_objects');
  const [chunks] = await database.query('SELECT count(*)::int total,count(*) FILTER(WHERE embedding IS NOT NULL)::int con_vector,count(*) FILTER(WHERE embedding IS NULL)::int sin_vector FROM chunks');
  const models = await database.query('SELECT embedding_model model,count(*)::int chunks FROM chunks WHERE embedding IS NOT NULL GROUP BY embedding_model');
  const bytes=Number(size.bytes),storageBytes=Number(objects.bytes);
  return {database:{bytes,limit:500_000_000,percent:bytes/5_000_000},
    storage:{bytes:storageBytes,limit:1_000_000_000,percent:storageBytes/10_000_000,objects:objects.objects,approximate:true},
    chunks,models,warning:bytes>=400_000_000||storageBytes>=800_000_000};
}
