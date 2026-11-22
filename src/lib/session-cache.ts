import { createHash } from "node:crypto";

/** Memoria efímera del proceso: claves hash, sin archivos, base de datos ni logs. */
export function createSessionCache<T>(ttl = 300_000, capacity = 128) {
  const values = new Map<string, { until: number; value: Promise<T> }>();
  return (content: unknown, work: () => Promise<T>): Promise<T> => {
    const normalize = (v: unknown): unknown => typeof v === "string" ? v.normalize("NFC").trim().replace(/\s+/g, " ")
      : Array.isArray(v) ? v.map(normalize) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)])) : v;
    const key = createHash("sha256").update(JSON.stringify(normalize(content))).digest("hex");
    const now = Date.now();
    for (const [k, item] of values) if (item.until <= now) values.delete(k);
    const found = values.get(key);
    if (found) return found.value;
    while (values.size >= capacity) values.delete(values.keys().next().value!);
    const value = Promise.resolve().then(work).catch(error => { values.delete(key); throw error; });
    values.set(key, { until: now + ttl, value });
    return value;
  };
}
