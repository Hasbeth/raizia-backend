import assert from 'node:assert/strict';

// Subconjunto deliberado del Schema de Gemini usado por conversar, no JSON Schema arbitrario.
export function assertGeminiSchema(schema, path = 'response_schema') {
  const admitted = new Set(['type', 'properties', 'required', 'items', 'enum', 'nullable']);
  for (const [key, value] of Object.entries(schema)) {
    assert.ok(admitted.has(key), `Unknown name "${key}" at ${path}`);
    if (key === 'properties') for (const [name, child] of Object.entries(value)) assertGeminiSchema(child, `${path}.properties.${name}`);
    if (key === 'items') assertGeminiSchema(value, `${path}.items`);
  }
}
