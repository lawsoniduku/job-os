/**
 * ingest/core/language.js
 * =======================
 * Cheap, dependency-free English-likelihood check. This is what stops the
 * "German-language jobs" problem at the source (Arbeitnow et al.) instead of
 * letting them leak into search.
 *
 * Heuristic (no ML, no network):
 *   - score by English stopword density
 *   - penalise diacritic-heavy text and German/French/Spanish marker words
 * Returns true if the text is *probably* English. Tunable threshold.
 */

const EN_STOP = new Set([
  "the", "and", "for", "you", "with", "your", "our", "are", "will", "have",
  "this", "that", "work", "team", "role", "experience", "we", "to", "of", "in",
  "a", "is", "as", "on", "at", "or", "an", "be", "by",
]);

// strong non-English markers (frequent words that rarely appear in EN JDs)
const NON_EN_MARKERS = [
  // German
  "und", "wir", "für", "mit", "sie", "deine", "unsere", "stellenangebot", "mitarbeiter", "aufgaben", "kenntnisse",
  // French
  "vous", "nous", "votre", "notre", "poste", "entreprise", "compétences", "expérience",
  // Spanish / Portuguese
  "nosotros", "tus", "empresa", "experiencia", "trabajo", "você", "vaga",
  "remoto", "administrativo", "asistente", "assistente", "auxiliar", "profesor",
  "enseñanza", "español", "ensino", "vagas", "salário", "horario", "flexible",
  "atención", "desarrollador", "ingeniero", "gerente", "ventas",
];

export function looksEnglish(text = "", { threshold = 0.45 } = {}) {
  const t = String(text).toLowerCase();
  if (!t.trim()) return true; // no text -> don't drop on language grounds

  const words = t.split(/[^a-zà-ÿ]+/).filter(Boolean);

  // Even on short text (e.g. a 3-word title), if a strong non-English marker
  // is present, drop it. This catches titles like "Auxiliar Administrativo
  // Remoto" that the length-escape below would otherwise wave through.
  for (const w of words) if (NON_EN_MARKERS.includes(w)) return false;

  if (words.length < 8) return true; // too short to judge on density; keep

  let enHits = 0;
  for (const w of words) if (EN_STOP.has(w)) enHits++;
  const enDensity = enHits / Math.min(words.length, 200);

  let nonEnHits = 0;
  for (const w of words) if (NON_EN_MARKERS.includes(w)) nonEnHits++;
  const nonEnDensity = nonEnHits / Math.min(words.length, 200);

  // diacritic ratio (German/French/etc heavy)
  const diacritics = (t.match(/[àâäçéèêëîïôöùûüßñõ]/g) || []).length;
  const diacriticRatio = diacritics / Math.max(t.length, 1);

  if (nonEnDensity > 0.03) return false;
  if (diacriticRatio > 0.02) return false;
  return enDensity >= threshold / 10; // density is small numbers; scaled threshold
}
