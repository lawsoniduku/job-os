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

// Read the leading geography list only. A requirement such as "based in
// Nigeria and support customers in Germany" names one hiring country, not two.
const geographyPatterns = new WeakMap();
function geographyList(text, countryTerms) {
  let name = geographyPatterns.get(countryTerms);
  if (!name) {
    const aliases = [...new Set([
      ...Object.entries(countryTerms).flatMap(([key, terms]) => [key, ...terms]),
      ...Object.keys(REGIONS),
    ])].sort((a, b) => b.length - a.length);
    name = new RegExp(`^(?:the\\s+)?(${aliases.map(escape).join('|')})(?![a-z])`, 'i');
    geographyPatterns.set(countryTerms, name);
  }
  let rest = text.trim();
  const parts = [];
  let end = 0;
  while (rest) {
    const match = rest.match(name);
    if (!match) break;
    parts.push(match[0]);
    rest = rest.slice(match[0].length);
    end = text.length - rest.length;
    const separator = rest.match(/^\s*(?:,\s*(?:(?:or|and)\s+)?|\/\s*|(?:or|and)\s+)/);
    if (!separator) break;
    rest = rest.slice(separator[0].length);
  }
  return { targets: targetsIn(parts.join(' / '), countryTerms), text: text.slice(0, end) };
}

export function extractHiringScopes(text, countryTerms) {
  const normalized = text.toLowerCase()
    .replace(/u\.s\.(?:a\.)?/g, 'usa').replace(/u\.k\./g, 'uk');
  const scopes = [];
  // Each pattern identifies the applicant, the role, or a structured job
  // location. Company offices, headquarters and customer markets are not
  // applicant requirements, even when they mention "based" or "location".
  const patterns = [
    { required: true, re: /\b(?:job\s+)?locations?\s*(?::\s*|\s+)(?:(?:fully\s+)?remote\s*[,(:—–-]?\s*(?:(?:in|within|across)\s+)?)?([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:must|required to|need to)\s+(?:currently\s+)?(?:be\s+)?(?:based|located|resident|residing|reside|live|living)\s+(?:in|within)\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:candidates?|applicants?|you)\s+(?:are|is|should|will)\s+(?:currently\s+)?(?:be\s+)?(?:based|located|resident|residing|reside|live|living)\s+(?:in|within)\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:this\s+)?(?:role|position|job)\s+(?:is|will be)\s+(?:based|located)\s+(?:in|within)\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:must|need to|required to)\s+(?:be\s+)?(?:legally\s+)?(?:authorized|authorised|eligible)\s+to\s+work\s+in\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:must|required to|need to)\s+(?:be\s+)?(?:a\s+)?resident\s+of\s+([^.!?;\n]{1,180})/g },
    // These short headings describe eligibility even without a full sentence.
    { required: true, re: /\b(?:eligibility|(?:candidate\s+|applicant\s+)?requirements?)\s*(?::\s*|\n\s*)(?:[-•]\s*)?(?:(?:must\s+)?(?:be\s+)?)?(?:based|located|residing|reside|live|living)\s+(?:in|within)\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:eligibility|(?:candidate\s+|applicant\s+)?requirements?)\s*(?::\s*|\n\s*)(?:[-•]\s*)?(?:residents?\s+of|(?:a\s+)?resident\s+in)\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:must|need to|required to)\s+be\s+(?:currently\s+)?(?:in|within)\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:candidates?|applicants?|you)\s+(?:must have|need|require|will need|are required to have)\s+(?:valid\s+)?(?:work\s+authori[sz]ation|(?:the\s+)?right\s+to\s+work|permission\s+to\s+work)\s+in\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:candidates?|applicants?|you)\s+(?:are|is|should be|will be)\s+(?:legally\s+)?(?:authori[sz]ed|eligible)\s+to\s+work\s+in\s+([^.!?;\n]{1,180})/g },
    { required: true, re: /\b(?:eligibility|(?:candidate\s+|applicant\s+)?requirements?)\s*(?::\s*|\n\s*)(?:[-•]\s*)?(?:(?:must\s+)?(?:have\s+)?)?(?:work\s+authori[sz]ation|(?:the\s+)?right\s+to\s+work|permission\s+to\s+work|(?:legally\s+)?(?:authori[sz]ed|eligible)\s+to\s+work)\s+in\s+([^.!?;\n]{1,180})/g },
    // A remote work location is role metadata, unlike a company address.
    { required: true, re: /\b(?:fully\s+)?remote\s*(?:[—–,(:-]\s*|(?:in|within|across)\s+)([^.!?;\n]{1,180})/g },
    { required: false, re: /\bresidents?\s+of\s+([^.!?;\n]{1,180})/g },
    { required: false, re: /\b(?:open to|hiring|accepting)\s+(?:(?:remote\s+)?(?:candidates|applicants|residents|people)\s+)?(?:who (?:are|live)\s+)?(?:(?:based|located|residing)\s+)?(?:in|from|across)\s+([^.!?;\n]{1,180})/g },
    { required: false, re: /\bopen to\s+(nigeria|kenya|ghana|africa|emea|europe|canada|india|south africa)\b/g },
  ];
  for (const { re, required } of patterns) {
    for (const match of normalized.matchAll(re)) {
      // Negated requirements must not become exclusions.
      const before = normalized.slice(Math.max(0, match.index - 25), match.index);
      if (/\b(?:not|never|no longer)\s+$/.test(before)) continue;
      if (/^locations?\b/.test(match[0]) && /\b(?:company|customer|headquarters?|hq|office)\s+$/.test(before)) continue;
      const geography = geographyList(match[1], countryTerms);
      const targets = geography.targets;
      const only = match[1].slice(geography.text.length).match(/^\s*only\b/);
      if (targets.length) scopes.push({
        targets,
        required: required || !!only,
        evidence: match[0].slice(0, match[0].length - match[1].length) + geography.text + (only?.[0] || ''),
      });
    }
  }
  return scopes;
}

export function scopeAllows(targets, country) {
  return targets.some((target) => target === country || REGIONS[target]?.includes(country));
}

// "Anywhere in France" describes a country boundary, not global hiring.
export function qualifiedAnywhereTargets(location, countryTerms) {
  const m = String(location || '').toLowerCase().match(/\banywhere\s+(?:in|within|across)\s+(.+)/);
  return m ? targetsIn(m[1], countryTerms) : [];
}
