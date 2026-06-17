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
// IMPORTANT: only include words that are DISTINCTLY non-English. Words spelled
// the same in English (e.g. "flexible") or near-identical English cognates must
// NOT be here — they cause valid English jobs to be dropped. ("flexible" alone
// was silently killing every JD that mentioned "flexible hours".)
const NON_EN_MARKERS = [
  // German (distinct)
  "und", "wir", "für", "mit", "sie", "deine", "unsere", "stellenangebot", "mitarbeiter", "aufgaben", "kenntnisse",
  // French (distinct)
  "vous", "nous", "votre", "notre", "entreprise", "compétences", "expérience",
  "professeur", "français", "recherchons", "emploi",
  // Spanish / Portuguese (distinct — removed English cognates like "flexible",
  // "remoto" stays since it's clearly ES/PT not EN, but ambiguous EN words removed)
  "nosotros", "tus", "empresa", "experiencia", "trabajo", "você", "vaga",
  "remoto", "asistente", "assistente", "auxiliar", "profesor",
  "enseñanza", "español", "ensino", "vagas", "salário",
  "atención", "desarrollador", "ingeniero", "ventas",
];
// Words intentionally REMOVED from the list because they are valid English or
// ambiguous and were causing false drops:
//   "flexible"       — identical in EN; appears in most JDs ("flexible hours")
//   "administrativo" — too close to EN "administrative"; "administrativo" exact
//                       still rare, but the risk/benefit favors removal
//   "horario"        — low value; "poste"/"gerente" removed (gerente≈manager
//                       context, "poste" = FR/ES but also appears in EN tech)
//   "poste", "gerente", "administrativo", "horario", "flexible"

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

/**
 * Job-level English check that TRUSTS THE TITLE.
 * A genuinely non-English job almost always has a non-English title. So if the
 * title is clearly English (no non-EN markers, no heavy diacritics), we keep the
 * job even if the description has a few accented words ("café", "résumé") or
 * stray foreign characters — which previously caused valid English jobs like
 * "Assistant Transport Officer" to be dropped on description noise alone.
 * Only when the title itself looks non-English do we drop.
 */
export function looksEnglishJob(job = {}) {
  const title = String(job.title || "").trim();
  const desc = String(job.description || "").trim();

  // 1. If the title carries a hard non-English marker, drop immediately.
  const titleWords = title.toLowerCase().split(/[^a-zà-ÿ]+/).filter(Boolean);
  for (const w of titleWords) if (NON_EN_MARKERS.includes(w)) return false;

  // 2. If the title is heavily accented (clearly a non-EN language), drop.
  const titleDiac = (title.toLowerCase().match(/[àâäçéèêëîïôöùûüßñõ]/g) || []).length;
  if (title.length > 0 && titleDiac / title.length > 0.08) return false;

  // 3. Title looks English (or is too short to judge) -> trust it, keep the job.
  //    We still run the full check on the combined text, but only DROP if BOTH
  //    the combined text fails AND the title wasn't a clear English signal.
  if (titleWords.length >= 2 && looksEnglish(title)) return true;

  // 4. Fallback: judge on title + description together (original behavior).
  return looksEnglish(`${title} ${desc}`);
}
