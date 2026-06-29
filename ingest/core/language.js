/**
 * ingest/core/language.js
 * =======================
 * Language gate for incoming job postings. Keeps English-language listings,
 * drops clearly non-English ones BEFORE they reach the database.
 *
 * Design principles (learned the hard way):
 *
 *  1. TITLE IS AUTHORITATIVE. Descriptions are noisy — a perfectly good English
 *     job can have an accented loanword ("café", "naïve"), a bilingual snippet,
 *     or a company blurb in another language. Judging by the whole description
 *     wrongly drops valid English roles. So `looksEnglishJob()` trusts the TITLE
 *     first: if the title reads as English, we keep the job.
 *
 *  2. BE CONSERVATIVE. A false drop (losing a real English job) is worse than a
 *     false keep (one foreign job slips through and gets filtered elsewhere).
 *     When unsure, KEEP.
 *
 *  3. NO INNOCENT WORDS AS MARKERS. "flexible" is an English word — it was once
 *     wrongly listed as a non-English marker and silently dropped valid jobs.
 *     Markers below are words/diacritics that do NOT occur in normal English
 *     job posts.
 *
 * Exports:
 *   looksEnglish(text)     -> boolean   (judge an arbitrary string)
 *   looksEnglishJob(job)   -> boolean   (judge a job; title-anchored)
 */

// Common English function words. If several of these appear, the text is English.
const ENGLISH_STOPWORDS = [
  "the", "and", "for", "with", "you", "our", "are", "will", "your", "this",
  "that", "have", "from", "team", "work", "role", "we", "to", "of", "in",
  "as", "is", "or", "be", "an", "on", "at", "by", "a", "experience", "skills",
  "manage", "support", "develop", "lead", "build", "ensure", "responsible",
  "required", "preferred", "must", "should", "join", "looking", "seeking",
];

// Strong non-English signals: words that are unambiguous in another language and
// effectively never appear as standalone tokens in an English job description.
// (Deliberately conservative — only high-confidence foreign function words.)
const NON_ENGLISH_MARKERS = [
  // French
  "nous", "vous", "votre", "notre", "avec", "pour", "dans", "être", "vos",
  "recherche", "entreprise", "poste", "compétences", "expérience", "métier",
  // Spanish
  "nosotros", "para", "trabajo", "empresa", "experiencia", "habilidades",
  "buscamos", "requisitos", "puesto", "conocimientos",
  // German
  "und", "der", "die", "das", "für", "mit", "wir", "sie", "ihre", "kenntnisse",
  "aufgaben", "unternehmen", "erfahrung", "stelle", "bewerbung",
  // Portuguese
  "você", "nós", "para", "empresa", "experiência", "trabalho", "vaga", "requisitos",
  // Dutch
  "jij", "wij", "onze", "voor", "met", "ervaring", "vereisten",
  // Italian
  "noi", "voi", "azienda", "esperienza", "competenze", "lavoro",
];

// Diacritic ranges that strongly suggest non-English text when DENSE.
// A single accented character is fine (loanwords); many are a signal.
const DIACRITIC_RE = /[àâäçéèêëîïôöùûüÿœ æ ñ ß ã õ ê ç]/gi;

const tokenize = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")     // strip any HTML
    .replace(/[^a-zà-ÿ\s]/gi, " ") // keep letters (incl. accented) + spaces
    .split(/\s+/)
    .filter(Boolean);

/**
 * Judge an arbitrary string. Returns true if it looks like English.
 * Conservative: empty / very short text is treated as English (keep).
 */
export function looksEnglish(text) {
  const tokens = tokenize(text);
  if (tokens.length < 3) return true; // too little to judge — keep

  const total = tokens.length;
  let englishHits = 0;
  let foreignHits = 0;

  const stop = new Set(ENGLISH_STOPWORDS);
  const foreign = new Set(NON_ENGLISH_MARKERS);

  for (const t of tokens) {
    if (stop.has(t)) englishHits++;
    if (foreign.has(t)) foreignHits++;
  }

  // Diacritic density: fraction of characters that are accented.
  const accentMatches = (text.match(DIACRITIC_RE) || []).length;
  const accentDensity = accentMatches / Math.max(text.length, 1);

  const englishRatio = englishHits / total;
  const foreignRatio = foreignHits / total;

  // Decision:
  //  - Clear English signal (several stopwords) AND not strongly foreign -> English.
  //  - Strong foreign signal (many foreign function words OR dense accents)
  //    that outweighs English signal -> not English.
  if (foreignRatio > 0.06 && foreignRatio > englishRatio) return false;
  if (accentDensity > 0.04 && englishRatio < 0.08) return false;
  if (englishHits >= 2 || englishRatio >= 0.05) return true;

  // Ambiguous and no strong English signal: lean KEEP unless clearly foreign.
  return foreignRatio < 0.04;
}

/**
 * Judge a JOB. Title-anchored: if the title reads as English, keep the job —
 * even if the description has accented noise. Only when the title is too short
 * or ambiguous do we consult the description.
 */
export function looksEnglishJob(job) {
  if (!job) return true;
  const title = (job.title || "").trim();
  const description = (job.description || "").trim();

  const foreign = new Set(NON_ENGLISH_MARKERS);
  const stop = new Set(ENGLISH_STOPWORDS);
  const titleTokens = tokenize(title);

  // Foreign function words in the title -> strong non-English signal.
  const foreignInTitle = titleTokens.filter((t) => foreign.has(t)).length;
  if (titleTokens.length >= 2 && foreignInTitle / titleTokens.length > 0.3) {
    return false;
  }

  // English function words in the title -> high-precision KEEP. Titles are short
  // and curated; an English stopword present means it's an English title, and we
  // ignore description noise (accented loanwords etc.).
  const englishInTitle = titleTokens.filter((t) => stop.has(t)).length;
  if (englishInTitle >= 1) return true;

  // Title has neither English stopwords nor foreign markers (e.g. "Développeur
  // Web Senior", "Data Analyst", "Ingeniero de Software"). The title alone is
  // inconclusive — defer to the full-text judgement, which weighs the
  // description's English vs. foreign signal and accent density.
  return looksEnglish(`${title} ${description}`);
}

export default { looksEnglish, looksEnglishJob };
