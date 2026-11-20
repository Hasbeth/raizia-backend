import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { dataDir, isLocal } from './database.mjs';

export const hashBytes = value => createHash('sha256').update(value).digest('hex');
export function objectPath(value) {
  if (typeof value !== 'string' || !value || value.includes('..') || !/^[a-zA-Z0-9_./-]+$/.test(value) || value.startsWith('/')) throw new Error('Ruta de almacenamiento inválida.');
  return value;
}
export function createStorage(database) {
  const remote = !isLocal() && !!process.env.SUPABASE_URL;
  if (process.env.VERCEL && !isLocal() && !remote) throw new Error('Configura SUPABASE_URL en Vercel: Storage local no es persistente.');
  if (remote && !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY.');
  const client = remote ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) : null;
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.RAIZIA_STORAGE_DIR || path.join(dataDir(), 'storage'));
  const file = (bucket, name) => path.join(directory, objectPath(bucket), objectPath(name));
  const remember = async (bucket, name, buffer) => database.query(
    'INSERT INTO storage_objects(bucket,path,bytes,content_hash) VALUES($1,$2,$3,$4) ON CONFLICT(bucket,path) DO UPDATE SET bytes=excluded.bytes,content_hash=excluded.content_hash,updated_at=CURRENT_TIMESTAMP',
    [bucket,name,buffer.length,hashBytes(buffer)]);
  return {
    remote, client,
    async ensureBuckets() {
      if (!client) return;
      for (const bucket of ['documentos','textos']) {
        const { data, error } = await client.storage.getBucket(bucket);
        if (error && !/not found|does not exist/i.test(error.message)) throw error;
        if (!data) {
          const result = await client.storage.createBucket(bucket, { public: false, fileSizeLimit: 30 * 1024 * 1024 });
          if (result.error && !/already exists/i.test(result.error.message)) throw result.error;
        } else if (data.public) {
          const result = await client.storage.updateBucket(bucket, { public: false });
          if (result.error) throw result.error;
        }
      }
    },
    async put(bucket, name, buffer, contentType = 'application/octet-stream', { skipUnchanged = false } = {}) {
      objectPath(name);
      if (skipUnchanged) {
        const [existing] = await database.query('SELECT content_hash FROM storage_objects WHERE bucket=$1 AND path=$2', [bucket,name]);
        if (existing?.content_hash === hashBytes(buffer)) return false;
      }
      if (client) {
        const { error } = await client.storage.from(bucket).upload(name, buffer, { contentType, upsert: true });
        if (error) throw error;
      } else {
        const target = file(bucket,name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, buffer);
      }
      await remember(bucket,name,buffer);
      return true;
    },
    async get(bucket,name) {
      objectPath(name);
      if (client) {
        const { data,error } = await client.storage.from(bucket).download(name);
        if (error) {
          if (String(error.statusCode) === '404' || /not found|does not exist/i.test(error.message)) return null;
          throw error;
        }
        return Buffer.from(await data.arrayBuffer());
      }
      try { return await fs.readFile(file(bucket,name)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async remove(bucket,name) {
      objectPath(name);
      if (client) {
        const { error } = await client.storage.from(bucket).remove([name]);
        if (error) throw error;
      } else { await fs.rm(file(bucket,name), { force: true }); }
      await database.query('DELETE FROM storage_objects WHERE bucket=$1 AND path=$2', [bucket,name]);
    },
    async signedDownload(name, download = false) {
      if (!client) return null;
      const { data,error } = await client.storage.from('documentos').createSignedUrl(objectPath(name), 60, { download });
      if (error) throw error;
      return data.signedUrl;
    },
    async signedUpload(name) {
      objectPath(name);
      if (!client) return { local: true, path: name, uploadUrl: '/api/admin/uploads?path='+encodeURIComponent(name), method: 'PUT' };
      const { data,error } = await client.storage.from('documentos').createSignedUploadUrl(name);
      if (error) throw error;
      return { local: false, path: name, uploadUrl: data.signedUrl, method: 'PUT' };
    },
    remember,
  };
}
export const packViewer = viewer => gzipSync(Buffer.from(JSON.stringify(viewer)));
export const unpackViewer = buffer => JSON.parse(gunzipSync(buffer).toString('utf8'));
