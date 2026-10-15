// Explicit hiring geography, distinct from company addresses and customer markets.
// Keep the quoted evidence so a rejection can explain the actual requirement.
const REGIONS = {
  africa: ['nigeria', 'kenya', 'ghana', 'southafrica', 'egypt', 'rwanda', 'ethiopia', 'tanzania', 'uganda', 'senegal', 'morocco', 'coted_ivoire', 'zambia', 'zimbabwe'],
  europe: ['uk', 'germany', 'france', 'netherlands', 'spain', 'italy', 'portugal', 'poland', 'sweden', 'norway', 'denmark', 'finland', 'switzerland', 'austria', 'belgium', 'ireland', 'czechia', 'romania', 'ukraine', 'greece', 'hungary', 'turkey'],
  mena: ['uae', 'saudi', 'qatar', 'jordan', 'lebanon', 'egypt', 'morocco'],
  latam: ['brazil', 'mexico', 'argentina', 'colombia', 'chile', 'peru'],
  seasia: ['philippines', 'indonesia', 'vietnam', 'thailand', 'malaysia', 'singapore'],
};
REGIONS.emea = [...new Set([...REGIONS.africa, ...REGIONS.europe, ...REGIONS.mena])];
REGIONS.apac = [...REGIONS.seasia, 'india', 'pakistan', 'bangladesh', 'srilanka', 'china', 'japan', 'southkorea', 'taiwan', 'hongkong', 'australia', 'newzealand'];
REGIONS['north america'] = ['us', 'canada', 'mexico'];
REGIONS.eu = ['germany', 'france', 'netherlands', 'spain', 'italy', 'portugal', 'poland', 'sweden', 'denmark', 'finland', 'austria', 'belgium', 'ireland', 'czechia', 'romania', 'greece', 'hungary'];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundary = (s) => new RegExp(`\\b${escape(s)}\\b`, 'gi');

function targetsIn(text, countryTerms) {
  const targets = [];
  let remaining = text.toLowerCase();
  // Remove country names before region matching: South Africa is not Africa-wide.
  const terms = Object.entries(countryTerms)
    .filter(([key]) => !REGIONS[key])
    .flatMap(([key, aliases]) => [...new Set([key, ...aliases])].map((alias) => [key, alias]))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, alias] of terms) {
    const re = boundary(alias);
    if (re.test(remaining)) {
      targets.push(key);
      remaining = remaining.replace(boundary(alias), ' ');
    }
  }
  for (const key of Object.keys(REGIONS)) {
    if (boundary(key).test(remaining)) targets.push(key);
  }
  return [...new Set(targets)];
}

export function extractHiringScopes(text, countryTerms) {
  const normalized = text.toLowerCase()
    .replace(/u\.s\.(?:a\.)?/g, 'usa').replace(/u\.k\./g, 'uk');
  const scopes = [];
  // Deliberately candidate-focused. "Our headquarters are in Kenya" is not
  // an instruction that applicants must live there.
  const patterns = [
    /\blocation\s*:\s*(?:fully\s+)?remote\s+(?:in|within|across)\s+([^.!?;\n]{1,180})/g,
    /\b(?:must|required to|need to)\s+(?:currently\s+)?(?:be\s+)?(?:based|located|resident|residing|reside|live|living)\s+in\s+([^.!?;\n]{1,180})/g,
    /\b(?:open to|hiring|accepting)\s+(?:(?:remote\s+)?(?:candidates|applicants|residents|people)\s+)?(?:who (?:are|live)\s+)?(?:(?:based|located|residing)\s+)?(?:in|from|across)\s+([^.!?;\n]{1,180})/g,
    /\bopen to\s+(nigeria|kenya|ghana|africa|emea|europe|canada|india|south africa)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      // Negated requirements must not become exclusions.
      const before = normalized.slice(Math.max(0, match.index - 25), match.index);
      if (/\b(?:not|never|no longer)\s+$/.test(before)) continue;
      const targets = targetsIn(match[1], countryTerms);
      if (targets.length) scopes.push({
        targets,
        required: /^(?:must|required to|need to|location)\b/.test(match[0]) || /\bonly\b/.test(match[0]),
        evidence: match[0],
      });
    }
  }
  return scopes;
}

export function scopeAllows(targets, country) {
  return targets.some((target) => target === country || REGIONS[target]?.includes(country));
}
