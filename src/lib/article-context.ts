export const ARTICLE_CONTEXT_LIMIT = 3500;

export function isArticle(hit: { weight?: number; heading: string }): boolean {
  return (hit.weight ?? 1) >= 1 && /\bart[ií]culo\s+\d+\b/i.test(hit.heading);
}

/** Los fragmentos están ordenados; solo elimina el traslape entre vecinos. */
export function joinArticle(parts: string[]): string {
  let text = "";
  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    let overlap = Math.min(text.length, next.length);
    while (overlap > 0) {
      const shared = next.slice(0, overlap);
      const word = (char: string) => /[\p{L}\p{N}]/u.test(char);
      // Una letra o un signo coincidente no es un traslape: no mutilar palabras.
      const wholeStart = !word(text[text.length - overlap - 1] || "") || !word(shared[0]);
      const wholeEnd = !word(shared[shared.length - 1]) || !word(next[overlap] || "");
      if (text.endsWith(shared) && /[\p{L}\p{N}]/u.test(shared) && wholeStart && wholeEnd) break;
      overlap--;
    }
    text += overlap ? next.slice(overlap) : (text ? "\n" : "") + next;
  }
  return text;
}

/** Ventana de apartados completos, puntuada con la consulta y todos los subtemas. */
export function limitArticle(text: string, terms: string[]): string {
  if (text.length <= ARTICLE_CONTEXT_LIMIT) return text;
  const starts = [0];
  // Literales/numerales en líneas propias o enumeraciones corridas tras punto/punto y coma.
  const markers = /(?:^|[\r\n]|[;.][ \t]+)[ \t]*((?:(?:literal|numeral)\s+)?(?:[a-zñ]|[ivxlcdm]+|\d+(?:\.\d+)*)(?:[.)])[ \t]+|PAR[ÁA]GRAFO(?:[ \t]+\d+)?[.:]?[ \t]*)/gim;
  for (const match of text.matchAll(markers)) starts.push(match.index! + match[0].indexOf(match[1]));
  // Sin enumeración, los párrafos completos son la unidad mínima; nunca slice arbitrario.
  if (starts.length === 1) {
    for (const match of text.matchAll(/[.!?;]\s*\n\s*/g)) starts.push(match.index! + match[0].length);
  }
  const boundaries = [...new Set(starts)].sort((a, b) => a - b);
  const units = boundaries.map((start, i) => text.slice(start, boundaries[i + 1]).trim()).filter(Boolean);
  const scores = units.map(unit => {
    const folded = unit.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return [...new Set(terms)].filter(Boolean).reduce((n, term) => n + folded.split(term).length - 1, 0);
  });
  let best = "", bestScore = -1;
  for (let start = 0; start < units.length; start++) {
    let window = "", score = 0;
    for (let end = start; end < units.length; end++) {
      window += (window ? "\n" : "") + units[end];
      const candidate = (start ? "…\n" : "") + window + (end < units.length - 1 ? "\n…" : "");
      if (candidate.length > ARTICLE_CONTEXT_LIMIT) break;
      score += scores[end];
      if (score > bestScore || (score === bestScore && candidate.length > best.length)) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  // Un literal de más de 3.500 caracteres no se convierte en una cita incompleta.
  return best || "[El apartado completo supera el límite de contexto. Consulta el texto completo de la fuente.]";
}
