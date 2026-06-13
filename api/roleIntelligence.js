/**
 * ROLE INTELLIGENCE MODULE v3
 * ============================
 * - 15 role clusters, 250+ aliases
 * - Hard eligibility filtering (not just scoring)
 * - Honest match scoring: location eligibility is MANDATORY, not a bonus
 */

export const ROLE_TAXONOMY = [
  {
    cluster: "People Analytics",
    department: "HR",
    aliases: [
      "people analyst","people analytics","hr analyst","hr data analyst",
      "workforce analyst","workforce analytics","workforce insights",
      "hris analyst","hris specialist","hr systems analyst",
      "people data analyst","people insights analyst","talent analytics",
      "people operations analyst","hr reporting analyst","hr business intelligence",
      "compensation analyst","total rewards analyst","hr metrics analyst",
      "org design analyst","people science","hr technology analyst"
    ],
    keywords: ["hris","workday","bamboohr","successfactors","people data",
      "hr dashboard","workforce planning","headcount","attrition","org chart","hr kpi"]
  },
  {
    cluster: "Talent Acquisition",
    department: "HR",
    aliases: [
      "recruiter","talent acquisition","talent partner","sourcer",
      "technical recruiter","tech recruiter","recruitment specialist",
      "talent specialist","talent lead","talent manager",
      "recruitment consultant","executive recruiter","talent scout",
      "recruitment coordinator","talent coordinator","hr recruiter",
      "people recruiter","staffing specialist","resourcing partner","resourcing specialist"
    ],
    keywords: ["ats","greenhouse","lever","boolean search","candidate pipeline",
      "job offer","interview scheduling","employer branding","talent pool"]
  },
  {
    cluster: "HR Generalist / HRBP",
    department: "HR",
    aliases: [
      "hr generalist","hr business partner","hrbp","hr manager",
      "hr coordinator","hr advisor","hr consultant","hr associate",
      "people partner","people manager","people operations",
      "people ops manager","people ops specialist","hr operations",
      "hr ops","hr administrator","hr assistant","hr officer",
      "employee relations","employee experience","people experience",
      "hr lead","head of people","vp people","chief people officer",
      "learning and development","l&d specialist","training specialist",
      "organisational development","od specialist"
    ],
    keywords: ["onboarding","offboarding","performance management","engagement",
      "hr policies","employment law","payroll","benefits","culture","dei"]
  },
  {
    cluster: "Data Analytics",
    department: "Data",
    aliases: [
      "data analyst","business intelligence analyst","bi analyst",
      "product analyst","growth analyst","insights analyst",
      "analytics analyst","reporting analyst","data reporting analyst",
      "data operations analyst","analytics specialist","web analyst",
      "sql analyst","tableau developer","power bi developer",
      "looker developer","bi developer","analytics engineer"
    ],
    keywords: ["sql","tableau","power bi","looker","excel","google analytics",
      "dbt","dashboard","kpi","metrics","data visualization","a/b testing"]
  },
  {
    cluster: "Data Science",
    department: "Data",
    aliases: [
      "data scientist","machine learning engineer","ml engineer",
      "ai engineer","applied scientist","research scientist",
      "nlp engineer","computer vision engineer","deep learning engineer",
      "data science manager","lead data scientist","senior data scientist",
      "quantitative analyst","quant analyst","statistician",
      "decision scientist","modeling analyst","predictive analytics"
    ],
    keywords: ["machine learning","deep learning","tensorflow","pytorch","scikit-learn",
      "nlp","neural network","model training","feature engineering","mlops"]
  },
  {
    cluster: "Data Engineering",
    department: "Data",
    aliases: [
      "data engineer","analytics engineer","etl developer","etl engineer",
      "data platform engineer","data infrastructure engineer",
      "database engineer","database administrator","dba",
      "big data engineer","data architect","senior data engineer"
    ],
    keywords: ["spark","kafka","airflow","dbt","aws glue","bigquery",
      "snowflake","redshift","databricks","pipeline","etl","data warehouse"]
  },
  {
    cluster: "Software Engineering",
    department: "Engineering",
    aliases: [
      "software engineer","software developer","backend engineer",
      "frontend engineer","full stack engineer","fullstack engineer",
      "web developer","mobile developer","ios developer","android developer",
      "react developer","node developer","python developer","java developer",
      "rails developer","php developer","golang developer",
      "devops engineer","platform engineer","site reliability engineer",
      "sre","infrastructure engineer","cloud engineer","aws engineer",
      "security engineer","application developer","systems engineer",
      "api developer","integration engineer","lead engineer","staff engineer",
      "principal engineer","engineering manager","head of engineering",
      "support engineer","technical support engineer","customer support engineer",
      "software support engineer","linux support engineer","cloud support engineer",
      "qa engineer","test engineer","automation engineer"
    ],
    keywords: ["react","node.js","python","java","typescript","javascript",
      "aws","gcp","azure","kubernetes","docker","ci/cd","rest api","graphql","microservices"]
  },
  {
    cluster: "Product Management",
    department: "Product",
    aliases: [
      "product manager","product owner","associate product manager",
      "senior product manager","lead product manager","principal pm",
      "group product manager","head of product","vp product",
      "chief product officer","cpo","product lead","technical product manager",
      "growth product manager","platform product manager"
    ],
    keywords: ["product roadmap","user stories","sprints","okrs","backlog",
      "product strategy","go-to-market","product discovery","wireframes"]
  },
  {
    cluster: "Customer Success",
    department: "Operations",
    aliases: [
      "customer success manager","csm","customer success specialist",
      "account manager","key account manager","strategic account manager",
      "client success manager","client relationship manager",
      "client partner","partner success manager","customer engagement manager",
      "customer experience manager","cx manager","renewal manager",
      "customer success lead","head of customer success","vp customer success",
      "account executive","enterprise account manager"
    ],
    keywords: ["churn","nps","customer retention","upsell","cross-sell",
      "renewal","qbr","customer health score","crm","salesforce","hubspot"]
  },
  {
    cluster: "Customer Support",
    department: "Operations",
    aliases: [
      "customer support","customer service","support specialist",
      "support agent","support representative","customer care",
      "customer care agent","cx specialist","cx agent",
      "technical support","tier 1 support","tier 2 support",
      "help desk","service desk",
      "customer support manager","customer service manager",
      "complaints handler","dispute resolution specialist",
      "live chat agent","email support agent","phone support agent",
      "customer service representative","client support specialist",
      "customer experience specialist","service representative"
    ],
    keywords: ["zendesk","intercom","freshdesk","support tickets",
      "sla","first response time","csat","customer satisfaction","ticketing"]
  },
  {
    cluster: "Virtual Assistant",
    department: "Operations",
    aliases: [
      "virtual assistant","va","executive assistant","ea",
      "personal assistant","pa","administrative assistant",
      "admin assistant","office administrator","office manager",
      "operations assistant","executive support","c-suite assistant",
      "remote assistant","online assistant","scheduling coordinator","calendar manager"
    ],
    keywords: ["calendar management","scheduling","travel booking",
      "inbox management","expense reports","google workspace","microsoft 365","notion","asana"]
  },
  {
    cluster: "Digital Marketing",
    department: "Marketing",
    aliases: [
      "digital marketing manager","marketing manager","growth marketer",
      "performance marketer","paid media specialist","paid search specialist",
      "seo specialist","seo manager","sem specialist","ppc specialist",
      "social media manager","social media specialist","social media coordinator",
      "content marketing manager","content strategist","content writer",
      "copywriter","email marketing specialist","crm specialist",
      "brand manager","brand strategist","community manager",
      "influencer marketing manager","affiliate marketing manager",
      "demand generation manager","lifecycle marketing manager",
      "marketing analyst","market analyst","digital analyst","growth hacker"
    ],
    keywords: ["google ads","facebook ads","meta ads","linkedin ads",
      "seo","sem","google analytics","google tag manager","hubspot","klaviyo"]
  },
  {
    cluster: "Operations",
    department: "Operations",
    aliases: [
      "operations manager","operations lead","operations specialist",
      "operations coordinator","business operations manager",
      "operations analyst","business analyst","process analyst",
      "strategy manager","strategy consultant","strategy analyst","process improvement specialist",
      "lean specialist","six sigma","project manager","programme manager",
      "project coordinator","project lead","delivery manager",
      "scrum master","agile coach","change manager","transformation manager",
      "supply chain manager","logistics manager","procurement manager","chief of staff"
    ],
    keywords: ["process","efficiency","kpi","metrics","jira","confluence",
      "asana","monday.com","notion","okrs","reporting"]
  },
  {
    cluster: "Finance",
    department: "Finance",
    aliases: [
      "finance manager","financial controller","controller",
      "accountant","senior accountant","management accountant",
      "financial accountant","accounts payable","accounts receivable",
      "bookkeeper","payroll specialist","treasury analyst",
      "fp&a","fp&a analyst","financial planning analyst",
      "financial analyst","finance analyst","investment analyst",
      "risk analyst","credit analyst","fraud analyst","revenue analyst",
      "budget analyst","tax specialist","tax analyst",
      "audit specialist","internal auditor","external auditor",
      "chief financial officer","cfo","vp finance","head of finance"
    ],
    keywords: ["ifrs","gaap","quickbooks","xero","sap","oracle",
      "forecasting","budgeting","p&l","balance sheet","cash flow"]
  },
  {
    cluster: "Design / UX",
    department: "Design",
    aliases: [
      "ux designer","ui designer","ui/ux designer","product designer",
      "interaction designer","visual designer","graphic designer",
      "brand designer","web designer","motion designer",
      "ux researcher","user researcher","design researcher",
      "design lead","head of design","design manager","senior designer"
    ],
    keywords: ["figma","sketch","adobe xd","prototyping","wireframing",
      "user testing","design system","accessibility"]
  },
  {
    cluster: "Sales",
    department: "Sales",
    aliases: [
      "sales development representative","sdr","business development representative",
      "bdr","account executive","ae","enterprise sales","b2b sales",
      "inside sales","outside sales","field sales","sales manager",
      "sales director","vp sales","chief revenue officer","cro",
      "revenue operations","revops","sales operations","sales engineer",
      "solutions engineer","partnerships manager","bd manager",
      "business development manager","commercial manager","regional sales manager"
    ],
    keywords: ["salesforce","hubspot","outreach","salesloft","cold calling",
      "pipeline","quota","arr","mrr","deal closing","prospecting"]
  }
];

// ============================================================
// MATCHING PRIMITIVES — word-boundary aware
// ============================================================
// The old engine used naive String.includes(). That caused two classes of bug:
//   * the keyword "r" (R language) matched the letter r in almost every query,
//     dragging unrelated searches into "Data Analytics".
//   * "us only" matched "campus only"; "remote us" matched "remote user".
// Everything below matches on WORD BOUNDARIES instead.

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// cluster -> department lookup (used to hard-drop cross-department mismatches)
const CLUSTER_DEPARTMENT = Object.fromEntries(ROLE_TAXONOMY.map((e) => [e.cluster, e.department]));

// cache compiled phrase regexes (hot path on every search/enrich call)
const _reCache = new Map();
function phraseRe(phrase) {
  const key = phrase.toLowerCase();
  let re = _reCache.get(key);
  if (!re) {
    // match the phrase when flanked by non-alphanumerics (or string ends)
    re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(key)}(?:[^a-z0-9]|$)`, "i");
    _reCache.set(key, re);
  }
  return re;
}
function hasPhrase(text, phrase) { return phraseRe(phrase).test(text); }
function hasAny(text, phrases) { return phrases.some((p) => hasPhrase(text, p)); }

// ============================================================
// SHORT-TOKEN & BARE-NOUN ROUTING
// ============================================================
// Two-letter handles the old parser silently dropped ("hr", "pm", "ux"...).
// Matched on word boundaries so "ai" never fires on "email"/"available".
const SHORT_TOKENS = {
  hr: "HR Generalist / HRBP", hrbp: "HR Generalist / HRBP", "l&d": "HR Generalist / HRBP",
  ta: "Talent Acquisition",
  pm: "Product Management", po: "Product Management", apm: "Product Management",
  ux: "Design / UX", ui: "Design / UX",
  qa: "Software Engineering", sre: "Software Engineering", devops: "Software Engineering",
  ml: "Data Science", ai: "Data Science", nlp: "Data Science",
  ba: "Data Analytics", bi: "Data Analytics",
  etl: "Data Engineering", dba: "Data Engineering",
  sdr: "Sales", bdr: "Sales", ae: "Sales", revops: "Sales",
  cs: "Customer Success", csm: "Customer Success",
  va: "Virtual Assistant", ea: "Virtual Assistant", pa: "Virtual Assistant",
  seo: "Digital Marketing", sem: "Digital Marketing", ppc: "Digital Marketing", smm: "Digital Marketing",
  fpa: "Finance", "fp&a": "Finance",
};

// Bare role nouns: lower weight than a full alias, but enough to route
// "product roles", "design jobs", "sales position".
const BARE_NOUN_HINTS = {
  product: "Product Management",
  design: "Design / UX", designer: "Design / UX",
  sales: "Sales", selling: "Sales",
  marketing: "Digital Marketing",
  finance: "Finance", accounting: "Finance", accountant: "Finance",
  operations: "Operations", ops: "Operations",
  support: "Customer Support",
  recruiter: "Talent Acquisition", recruiting: "Talent Acquisition", recruitment: "Talent Acquisition",
  developer: "Software Engineering", engineer: "Software Engineering", engineering: "Software Engineering",
  analyst: "Data Analytics", analytics: "Data Analytics", data: "Data Analytics",
};

// ============================================================
// CLUSTER DETECTION — score-based, longest/most-specific wins
// ============================================================
function detectCluster(query) {
  const q = ` ${query.toLowerCase()} `;
  const scores = {};
  const bump = (c, n) => { if (c) scores[c] = Math.max(scores[c] || 0, n); };
  const add = (c, n) => { if (c) scores[c] = (scores[c] || 0) + n; };

  // 1. Multi-word / long aliases — strongest signal, weighted by specificity
  for (const entry of ROLE_TAXONOMY) {
    for (const alias of entry.aliases) {
      if (alias.length < 4) continue; // very short aliases handled below
      if (hasPhrase(q, alias)) {
        const specificity = alias.split(/\s+/).length * 12 + alias.length; // longer = better
        bump(entry.cluster, 40 + specificity);
      }
    }
  }
  // 2. Curated short tokens (hr, pm, ux, qa...)
  for (const [tok, cluster] of Object.entries(SHORT_TOKENS)) {
    if (hasPhrase(q, tok)) bump(cluster, 38);
  }
  // 3. Bare role nouns (product, design, sales...)
  for (const [noun, cluster] of Object.entries(BARE_NOUN_HINTS)) {
    if (hasPhrase(q, noun)) bump(cluster, 30);
  }
  // 4. Skill keywords — additive nudges only; skip <3 chars so "r"/"ai" can't dominate
  for (const entry of ROLE_TAXONOMY) {
    for (const kw of entry.keywords) {
      if (kw.length < 3) continue;
      if (hasPhrase(q, kw)) add(entry.cluster, 4);
    }
  }

  let best = null, bestScore = 0;
  for (const [c, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best ? { cluster: best, score: bestScore, all: scores } : { cluster: null, score: 0, all: {} };
}

// ============================================================
// GEOGRAPHY / ELIGIBILITY DATA
// ============================================================
// ── Global country/region recognition ────────────────────────────────────────
// Keys are the canonical country ID used throughout the eligibility engine.
// Values are the phrases that, when found in a query, identify the user's target.
// Rules:
//   * Only include terms that are UNAMBIGUOUS at word boundaries — no 2-letter
//     codes like "in" (India) or "me" (Mexico) because they appear in normal text.
//   * City names are included only when globally distinctive (Tokyo, Lagos, Seoul).
//   * Demonyms ("nigerians", "brazilians") are first-class — users say them often.
const COUNTRY_TERMS = {
  // ── Africa ────────────────────────────────────────────────────────────────
  nigeria:      ["nigeria","nigerian","nigerians","lagos","abuja","port harcourt"],
  kenya:        ["kenya","kenyan","kenyans","nairobi","mombasa","kisumu"],
  ghana:        ["ghana","ghanaian","ghanaians","accra","kumasi"],
  southafrica:  ["south africa","south african","south africans","cape town",
                 "johannesburg","durban","pretoria","joburg"],
  egypt:        ["egypt","egyptian","egyptians","cairo","alexandria"],
  rwanda:       ["rwanda","rwandan","rwandans","kigali"],
  ethiopia:     ["ethiopia","ethiopian","ethiopians","addis ababa"],
  tanzania:     ["tanzania","tanzanian","tanzanians","dar es salaam","dodoma"],
  uganda:       ["uganda","ugandan","ugandans","kampala"],
  senegal:      ["senegal","senegalese","dakar"],
  morocco:      ["morocco","moroccan","moroccans","casablanca","rabat"],
  coted_ivoire: ["ivory coast","côte d'ivoire","cote d'ivoire","abidjan"],
  zambia:       ["zambia","zambian","zambians","lusaka"],
  zimbabwe:     ["zimbabwe","zimbabwean","zimbabweans","harare"],

  // ── Middle East ───────────────────────────────────────────────────────────
  uae:          ["united arab emirates","uae","dubai","abu dhabi","sharjah"],
  saudi:        ["saudi arabia","saudi","saudis","riyadh","jeddah"],
  qatar:        ["qatar","qatari","qataris","doha"],
  jordan:       ["jordan","jordanian","jordanians","amman"],
  lebanon:      ["lebanon","lebanese","beirut"],

  // ── South & Southeast Asia ────────────────────────────────────────────────
  india:        ["india","indian","indians","bangalore","bengaluru","mumbai",
                 "hyderabad","pune","chennai","delhi","new delhi","kolkata"],
  pakistan:     ["pakistan","pakistani","pakistanis","karachi","lahore","islamabad"],
  bangladesh:   ["bangladesh","bangladeshi","bangladeshis","dhaka"],
  srilanka:     ["sri lanka","sri lankan","sri lankans","colombo"],
  philippines:  ["philippines","filipino","filipinos","manila","cebu"],
  indonesia:    ["indonesia","indonesian","indonesians","jakarta","bali"],
  vietnam:      ["vietnam","vietnamese","hanoi","ho chi minh","saigon"],
  thailand:     ["thailand","thai","thais","bangkok","chiang mai"],
  malaysia:     ["malaysia","malaysian","malaysians","kuala lumpur","kl"],
  singapore:    ["singapore","singaporean","singaporeans"],

  // ── East Asia ─────────────────────────────────────────────────────────────
  china:        ["china","chinese","beijing","shanghai","shenzhen","guangzhou",
                 "chengdu","hangzhou"],
  japan:        ["japan","japanese","tokyo","osaka","kyoto","yokohama"],
  southkorea:   ["south korea","south korean","south koreans","korea","korean",
                 "koreans","seoul","busan"],
  taiwan:       ["taiwan","taiwanese","taipei"],
  hongkong:     ["hong kong","hongkonger","hongkongers"],

  // ── Europe ────────────────────────────────────────────────────────────────
  uk:           ["united kingdom","uk","britain","british","london","manchester",
                 "birmingham","edinburgh","glasgow","bristol"],
  germany:      ["germany","german","germans","berlin","munich","hamburg",
                 "frankfurt","cologne","düsseldorf"],
  france:       ["france","french","paris","lyon","marseille","toulouse"],
  netherlands:  ["netherlands","dutch","amsterdam","rotterdam","the hague","utrecht"],
  spain:        ["spain","spanish","madrid","barcelona","seville","valencia"],
  italy:        ["italy","italian","italians","rome","milan","naples","turin"],
  portugal:     ["portugal","portuguese","lisbon","porto"],
  poland:       ["poland","polish","warsaw","krakow","wroclaw"],
  sweden:       ["sweden","swedish","swedes","stockholm","gothenburg","malmo"],
  norway:       ["norway","norwegian","norwegians","oslo","bergen"],
  denmark:      ["denmark","danish","danes","copenhagen"],
  finland:      ["finland","finnish","finns","helsinki"],
  switzerland:  ["switzerland","swiss","zurich","geneva","bern","basel"],
  austria:      ["austria","austrian","austrians","vienna","graz"],
  belgium:      ["belgium","belgian","belgians","brussels","antwerp","ghent"],
  ireland:      ["ireland","irish","dublin","cork","limerick"],
  czechia:      ["czech republic","czechia","czech","prague","brno"],
  romania:      ["romania","romanian","romanians","bucharest","cluj"],
  ukraine:      ["ukraine","ukrainian","ukrainians","kyiv","lviv","odesa"],
  greece:       ["greece","greek","greeks","athens","thessaloniki"],
  hungary:      ["hungary","hungarian","hungarians","budapest"],
  turkey:       ["turkey","turkish","turks","istanbul","ankara","izmir"],

  // ── Americas ─────────────────────────────────────────────────────────────
  us:           ["united states","usa","u.s.","us-based","us based","american",
                 "americans","new york","san francisco","los angeles","seattle",
                 "austin","chicago","boston","denver","atlanta","miami","dallas",
                 "washington dc","washington d.c.","portland","houston","phoenix",
                 "new york city","nyc","silicon valley"],
  canada:       ["canada","canadian","canadians","toronto","vancouver","montreal",
                 "calgary","ottawa","edmonton","winnipeg"],
  brazil:       ["brazil","brazilian","brazilians","são paulo","sao paulo",
                 "rio de janeiro","brasília","brasilia"],
  mexico:       ["mexico","mexican","mexicans","mexico city","guadalajara","monterrey"],
  argentina:    ["argentina","argentinian","argentinians","buenos aires","córdoba"],
  colombia:     ["colombia","colombian","colombians","bogota","medellín","medellin"],
  chile:        ["chile","chilean","chileans","santiago"],
  peru:         ["peru","peruvian","peruvians","lima"],

  // ── Oceania ───────────────────────────────────────────────────────────────
  australia:    ["australia","australian","australians","sydney","melbourne",
                 "brisbane","perth","adelaide","canberra"],
  newzealand:   ["new zealand","new zealander","new zealanders","auckland",
                 "wellington","christchurch"],

  // ── Broad regions (for queries like "anyone in LATAM" / "EU-based") ───────
  europe:       ["europe","european","eu based","eu-based","emea"],
  latam:        ["latin america","latam","south america","central america"],
  seasia:       ["southeast asia","sea","asean"],
  mena:         ["mena","middle east","middle eastern"],
};

// Countries/regions we treat as "Africa" for the positive-evidence logic.
const AFRICAN_COUNTRIES = new Set([
  "nigeria","kenya","ghana","southafrica","egypt","rwanda",
  "ethiopia","tanzania","uganda","senegal","morocco","coted_ivoire",
  "zambia","zimbabwe",
]);

// All Africa terms (used for the "open to Africa" region target).
const AFRICA_TERMS = [
  "africa", "african", "sub-saharan africa", "sub saharan", "west africa", "east africa",
  "pan-african", "pan african", "nigeria", "lagos", "abuja", "kenya", "nairobi", "mombasa",
  "ghana", "accra", "south africa", "cape town", "johannesburg", "durban", "rwanda", "kigali",
  "egypt", "cairo", "uganda", "kampala", "tanzania", "ethiopia", "senegal", "morocco",
];

const HARD_EXCLUSIONS = [
  "us only", "u.s. only", "usa only", "united states only",
  "must be located in the us", "must reside in the us", "must be based in the us",
  "must be authorized to work in the united states", "authorized to work in the us",
  "us work authorization", "us citizens only", "green card",
  "remote us only", "us remote only", "remote united states", "remote - united states",
  "remote (united states)", "remote, united states", "us-remote", "us remote",
  "uk only", "united kingdom only", "must be based in the uk", "right to work in the uk",
  "remote uk only", "remote - uk", "remote (uk)",
  "eu only", "europe only", "must be based in europe", "eu citizenship",
  "eu work authorization", "european union only", "remote - europe", "remote (europe)",
  "canada only", "must be based in canada", "canadian citizens", "work authorization in canada",
  "australia only", "must be based in australia", "australian citizens",
  "latam only", "latin america only",
  "us time zones only", "must work us hours", "est/cst/pst only",
];

// WORLDWIDE signals — ONLY trusted when they appear in the LOCATION or
// eligibility_region field (not the description body, where "doing business
// worldwide" is marketing copy about the company, not hiring eligibility).
const WORLDWIDE_LOCATION = [
  "worldwide", "anywhere in the world", "anywhere", "work from anywhere", "remote global",
  "remote - global", "remote, global", "globally distributed", "fully distributed",
  "location independent", "location-independent", "any country", "all countries",
  "no location restriction", "global remote", "home based - worldwide",
];

// STRONG hiring-eligibility phrases in the DESCRIPTION (explicit about WHO they
// hire, not what the company does). Weaker than a location signal -> "likely".
const WORLDWIDE_DESC_STRONG = [
  "open to candidates worldwide", "open to applicants worldwide", "hire from anywhere",
  "work from anywhere in the world", "open to international applicants", "hiring globally",
  "candidates from any country", "no matter where you are", "anywhere in the world",
  "open to candidates in africa", "candidates based in africa", "across africa", "open to nigeria",
];

const EMEA_POSITIVE = ["emea", "europe middle east africa", "europe, middle east, and africa", "europe, middle east & africa"];
const AMBIGUOUS_REMOTE = ["remote", "fully remote", "100% remote", "remote first", "remote-first", "work from home", "wfh", "distributed team", "async"];
const ONSITE_SIGNALS = ["on-site", "onsite", "on site", "in-office", "in office", "hybrid", "must relocate", "relocation required", "in-person"];

// Concrete non-African geographies. If one of these appears in the LOCATION field
// of a job and the text gives no worldwide/Africa signal, the role is almost
// always tied to that geography and NOT open to an African candidate. Matched on
// word boundaries (so "Austin" never matches "us", "Belarus" never matches "us").
const FOREIGN_GEO = [
  "united states", "usa", "u.s.", "us", "us based", "us-based", "americas",
  "new york", "san francisco", "los angeles", "seattle", "austin", "chicago",
  "boston", "denver", "atlanta", "miami", "dallas", "washington", "phoenix",
  "united kingdom", "uk", "london", "manchester", "edinburgh", "bristol",
  "germany", "berlin", "munich", "france", "paris", "netherlands", "amsterdam",
  "spain", "madrid", "barcelona", "ireland", "dublin", "poland", "warsaw",
  "portugal", "lisbon", "italy", "rome", "sweden", "stockholm", "switzerland",
  "canada", "toronto", "vancouver", "montreal", "ottawa",
  "australia", "sydney", "melbourne", "brisbane",
  "singapore", "india", "bangalore", "bengaluru", "mumbai", "hyderabad", "pune",
  "brazil", "mexico", "philippines", "japan", "tokyo",
  "china", "guangzhou", "shanghai", "beijing", "shenzhen", "hong kong",
  "south korea", "korea", "seoul", "taiwan", "vietnam", "indonesia", "jakarta", "malaysia",
  "north america", "latin america", "latam", "england", "scotland", "wales",
  "europe", "european union", "uae", "dubai", "qatar", "saudi arabia", "abu dhabi",
  "bulgaria", "romania", "serbia", "ukraine", "greece", "turkey", "hungary",
  "czech", "austria", "belgium", "denmark", "norway", "finland", "new zealand",
  "argentina", "colombia", "chile", "peru", "pakistan", "bangladesh", "thailand",
  // US states (locations like "Portland, Oregon" / "Pittsburgh, PA")
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
  "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
  "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
  "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "ohio",
  "oklahoma", "oregon", "pennsylvania", "tennessee", "texas", "utah", "vermont",
  "virginia", "wisconsin", "wyoming", "new jersey", "new mexico", "north carolina",
  "south carolina", "rhode island",
  // more US cities seen in feeds
  "portland", "pittsburgh", "nashville", "raleigh", "bethesda", "asheville", "tampa",
  "houston", "philadelphia", "san diego", "san jose", "columbus", "charlotte",
];

export const LOCATION_INTELLIGENCE = COUNTRY_TERMS;

// Restriction phrases that appear in the TITLE or BODY and OVERRIDE a board's
// generic "Anywhere in the World" location tag (WeWorkRemotely stamps that on
// nearly every post, including US-only ones). Generated from foreign regions.
const _RESTRICT_REGIONS = [
  "united states", "the united states", "usa", "the usa", "u.s.", "us", "the us",
  "uk", "united kingdom", "the uk", "canada", "europe", "the eu", "european union",
  "germany", "australia", "india", "philippines", "north america",
];
const RESTRICTION_PHRASES = [];
for (const r of _RESTRICT_REGIONS) {
  RESTRICTION_PHRASES.push(
    `based in ${r}`, `${r}-based`, `${r} based`, `located in ${r}`,
    `must be located in ${r}`, `reside in ${r}`, `must reside in ${r}`,
    `residents of ${r}`, `resident of ${r}`, `${r} only`,
    `locations: ${r}`, `location: ${r}`, `authorized to work in ${r}`,
    `work authorization in ${r}`, `must be in ${r}`, `eligible to work in ${r}`,
    `legally authorized to work in ${r}`,
  );
}
RESTRICTION_PHRASES.push(
  "remote - us", "fully remote - us", "remote, us", "remote (us)", "us-remote",
  "u.s. based", "us or canada", "united states or canada", "us/canada",
  "based in the us or canada", "must be based in the united states",
  "remote - usa", "remote-usa", "remote, usa", "remote usa", "remote – usa",
  "remote - united states", "remote (usa)", "based in united states or canada",
);

// High-precision non-English (mostly German/French) JD markers -> drop.
const NON_ENGLISH_MARKERS = [
  "m/w/d", "w/m/d", "wir bei", "wir suchen", "deine aufgaben", "über uns",
  "unser team", "kenntnisse", "stellenangebot", "aufgaben", "nous recherchons",
  "votre mission", "rejoignez", "buscamos", "nuestro equipo",
];

// COUNTRIES only (no cities) — scanned in the DESCRIPTION of bare-"Remote" jobs
// to catch roles whose location field is just "Remote" but whose body ties them
// to a specific country (e.g. "Headquarters: Cluj-Napoca, Romania").
const FOREIGN_COUNTRIES = [
  "united states", "usa", "u.s.", "united kingdom", "canada", "germany", "france",
  "spain", "italy", "netherlands", "ireland", "poland", "portugal", "romania",
  "bulgaria", "serbia", "ukraine", "greece", "turkey", "hungary", "austria",
  "belgium", "denmark", "norway", "finland", "switzerland", "sweden",
  "india", "china", "japan", "singapore", "australia", "new zealand", "brazil",
  "mexico", "argentina", "colombia", "philippines", "pakistan", "bangladesh",
  "vietnam", "indonesia", "malaysia", "thailand", "uae", "saudi arabia", "qatar",
];

// ============================================================
// ELIGIBILITY ENGINE
// ============================================================
/**
 * checkEligibility(job, country) -> { eligible, confidence, reason }
 * confidence: certain | likely | possible | excluded
 * Word-boundary matching throughout (fixes "campus only"/"remote user" bugs).
 */
export function checkEligibility(job, country) {
  const title = ` ${(job.title || "").toLowerCase()} `;
  const loc = (job.location || "").toLowerCase();
  const desc = (job.description || "").toLowerCase();
  const region = (job.eligibility_region || "").toLowerCase();
  const titleDesc = ` ${title} ${desc} `;
  const all = ` ${loc} ${desc} ${region} `;
  const isAfrican = country === "africa" || AFRICAN_COUNTRIES.has(country);

  // Broad-region targets → their positive location signals
  const REGION_POSITIVE = {
    europe: ["europe","eu","emea","european"],
    latam:  ["latin america","latam","south america","central america"],
    seasia: ["southeast asia","asean","apac"],
    mena:   ["mena","middle east","emea"],
  };

  const E = (confidence, reason, eligible = true) => ({ eligible, confidence, reason });

  // 1. Hard exclusions anywhere in text kill the job.
  for (const ex of HARD_EXCLUSIONS) if (hasPhrase(all, ex)) return E("excluded", `Restricted: "${ex}"`, false);

  // 1b. Non-English posting → drop.
  if (hasAny(titleDesc, NON_ENGLISH_MARKERS)) return E("excluded", "Non-English posting", false);

  // 1c. Non-Latin location (Arabic/CJK/Cyrillic) → region-specific, drop.
  if ((loc.match(/[^\x00-\x7F]/g) || []).length > 3)
    return E("excluded", "Region-specific (non-Latin location)", false);

  // 1d. Explicit restriction in TITLE or BODY overrides any generic "Anywhere" tag.
  if (hasAny(title, FOREIGN_GEO)) return E("excluded", "Title names a specific location", false);
  if (hasAny(titleDesc, RESTRICTION_PHRASES)) return E("excluded", "Role restricted to a specific region", false);

  // 2. Explicit target in LOCATION field → certain.
  const locField = ` ${loc} ${region} `;
  if (country === "africa") {
    if (hasAny(locField, AFRICA_TERMS)) return E("certain", "Location mentions Africa");
  } else if (REGION_POSITIVE[country]) {
    if (hasAny(locField, REGION_POSITIVE[country])) return E("certain", `Location mentions ${country}`);
  } else {
    for (const label of COUNTRY_TERMS[country] || []) {
      if (hasPhrase(locField, label)) return E("certain", `Location mentions ${label}`);
    }
  }

  // 3. Worldwide/anywhere in LOCATION → certain.
  if (hasAny(loc, WORLDWIDE_LOCATION)) return E("certain", "Open worldwide / anywhere");

  // 4. EMEA in location → likely for Africa and MENA targets.
  if ((isAfrican || country === "mena") && hasAny(loc, EMEA_POSITIVE))
    return E("likely", "EMEA region");

  // 5. POSITIVE-EVIDENCE GATE — universal for all country targets.
  //    Nothing matched above → no positive signal this role is open to target.
  //    Require evidence; don't default to "possible".
  const l = loc.trim();
  const bare = !l || ["remote","remote,","anywhere","n/a","-","not specified",
                      "remote worldwide","fully remote","global"].includes(l);
  if (!bare) return E("excluded", `Location tied to ${job.location}`, false);

  // Bare "Remote": read description for positive signal or country tie.
  if (hasAny(desc, WORLDWIDE_DESC_STRONG)) return E("likely", "JD: open to anyone, anywhere");
  if (hasAny(desc, FOREIGN_COUNTRIES)) return E("excluded", "Remote, but body ties it to a specific country", false);
  return E("possible", "Remote — region unconfirmed");
}

// ============================================================
// INTENT PARSER
// ============================================================
export function parseIntent(query) {
  const raw = query || "";
  const q = ` ${raw.toLowerCase().trim()} `;

  // Location target — specific country first, then broad Africa region,
  // then broad regions (latam / mena / europe / seasia).
  // Ordered so more specific keys win over broad ones.
  const REGION_KEYS = new Set(["africa", "europe", "latam", "seasia", "mena"]);
  let locationCountry = null;
  // check specific countries first (skip region keys in first pass)
  for (const [country, terms] of Object.entries(COUNTRY_TERMS)) {
    if (REGION_KEYS.has(country)) continue;
    if (hasAny(q, terms)) { locationCountry = country; break; }
  }
  // then Africa as a named region
  if (!locationCountry && hasAny(q, ["africa", "african", "africans", "pan-african",
      "sub-saharan", "west africa", "east africa"])) {
    locationCountry = "africa";
  }
  // then broad regions
  if (!locationCountry) {
    for (const rk of ["europe","latam","seasia","mena"]) {
      if (hasAny(q, COUNTRY_TERMS[rk] || [])) { locationCountry = rk; break; }
    }
  }

  const remoteOnly = hasAny(q, ["remote", "work from home", "wfh", "work from anywhere"]);

  // cluster (score-based)
  const det = detectCluster(raw);
  const cluster = det.cluster;
  const entry = cluster ? ROLE_TAXONOMY.find((e) => e.cluster === cluster) : null;
  const department = entry ? entry.department : null;
  const matchedAliases = entry ? entry.aliases : [];

  // seniority
  let seniority = null;
  if (/\b(senior|sr\.?|lead|principal|staff)\b/i.test(raw)) seniority = "senior";
  else if (/\b(junior|jr\.?|entry|entry-level|graduate|intern|trainee)\b/i.test(raw)) seniority = "junior";
  else if (/\b(manager|head of|director|vp|chief)\b/i.test(raw)) seniority = "manager";

  // keywords — now keeps 2-char tokens (hr, pm, ux, ai) and strips geo/filler
  const stop = new Set([
    "a", "an", "the", "in", "for", "of", "and", "or", "to", "is", "that", "are", "with",
    "remote", "job", "jobs", "role", "roles", "position", "positions", "looking", "find",
    "search", "want", "need", "open", "global", "globally", "anywhere", "worldwide",
    ...Object.values(COUNTRY_TERMS).flat(),
  ]);
  const keywords = raw.toLowerCase().split(/[^a-z0-9+#&.]+/).filter((w) => w.length >= 2 && !stop.has(w));

  return { cluster, department, locationCountry, remoteOnly, seniority, keywords, matchedAliases, clusterScores: det.all, rawQuery: raw };
}

// ============================================================
// HONEST MATCH SCORER — eligibility is a GATE, not a bonus
// ============================================================
export function scoreJobLocally(job, intent) {
  const title = ` ${(job.title || "").toLowerCase()} `;
  const desc = (job.description || "").toLowerCase();

  // STEP 1: eligibility gate
  let eligibility = { eligible: true, confidence: "possible", reason: "" };
  if (intent.locationCountry) {
    eligibility = checkEligibility(job, intent.locationCountry);
  } else if (intent.remoteOnly) {
    const all = ` ${(job.location || "").toLowerCase()} ${desc} `;
    if (hasAny(all, HARD_EXCLUSIONS)) eligibility = { eligible: false, confidence: "excluded", reason: "Geographically restricted" };
    else if (job.remote || hasPhrase(all, "remote")) eligibility = { eligible: true, confidence: "likely", reason: "Remote role" };
  }

  // STEP 2: role match (0–55) — judged by the job's OWN TITLE at search time,
  // so a stale stored role_cluster can't inflate an off-target role
  // (e.g. "Cloud Support Engineer" stored as Customer Support).
  let roleScore = 0;
  const titleAliasHit = intent.matchedAliases?.some((a) => hasPhrase(title, a));
  const descAliasHit = intent.matchedAliases?.some((a) => hasPhrase(desc, a));
  const titleCluster = detectCluster(job.title || "").cluster; // what the TITLE really is

  if (titleAliasHit) roleScore = 52;                                  // query alias in title = best
  else if (titleCluster && titleCluster === intent.cluster) roleScore = 46;  // title's own cluster matches
  else if (titleCluster && intent.cluster && titleCluster !== intent.cluster) roleScore = 6; // title is clearly a DIFFERENT role
  else if (descAliasHit) roleScore = 24;                            // query alias in body
  else if (intent.cluster && job.role_cluster === intent.cluster) {
    // only the stored label matches. Trust it ONLY if there's some textual signal
    // (a query keyword in title/desc); otherwise it's a likely mislabel -> weak.
    const hasSignal = intent.keywords.some((k) => k.length >= 3 && hasPhrase(`${title} ${desc}`, k));
    roleScore = hasSignal ? 26 : 7;
  }

  // offTarget: the title clearly belongs to a DIFFERENT department than the query
  // (e.g. "Support Engineer" -> Engineering vs a Customer Support search). The
  // server hard-drops these, so stale DB labels can't keep them in results even
  // before a re-classify. Sibling clusters in the same department are NOT dropped.
  const offTarget =
    !titleAliasHit && titleCluster && intent.cluster &&
    titleCluster !== intent.cluster &&
    CLUSTER_DEPARTMENT[titleCluster] && CLUSTER_DEPARTMENT[intent.cluster] &&
    CLUSTER_DEPARTMENT[titleCluster] !== CLUSTER_DEPARTMENT[intent.cluster];

  // query keyword overlap on the TITLE (rewards on-target titles)
  let kwTitle = 0;
  for (const k of intent.keywords) if (k.length >= 3 && hasPhrase(title, k)) kwTitle = Math.min(kwTitle + 4, 10);
  roleScore = Math.min(roleScore + kwTitle, 55);

  // seniority alignment (+/-)
  if (intent.seniority) {
    const map = { senior: ["senior", "sr", "lead", "principal", "staff"], junior: ["junior", "jr", "entry", "graduate", "intern", "associate", "trainee"], manager: ["manager", "head", "director", "vp"] };
    const wants = map[intent.seniority] || [];
    if (wants.some((t) => hasPhrase(title, t))) roleScore = Math.min(roleScore + 5, 55);
    else if (intent.seniority === "junior" && hasAny(title, ["senior", "principal", "staff", "lead", "director"])) roleScore -= 8;
  }

  // not eligible -> capped low score, kept out of main results by the gate
  if (!eligibility.eligible) {
    const capped = Math.min(roleScore, 18);
    return { score: Math.max(0, capped), eligibility, offTarget, breakdown: { roleScore: capped, locScore: 0 } };
  }

  // STEP 3: eligibility confidence component (0–34)
  const locScore = { certain: 34, likely: 26, possible: 14 }[eligibility.confidence] ?? 14;

  // STEP 4: small nuance signals so equally-good roles still differentiate
  let bonus = 0;
  const d = job.posted_at || job.created_at;
  if (d) {
    const days = (Date.now() - new Date(d)) / 86400000;
    if (days < 3) bonus += 6; else if (days < 7) bonus += 4; else if (days < 14) bonus += 2; else if (days > 60) bonus -= 3;
  }
  if (job.salary_min || job.salary_max) bonus += 2;       // transparent salary
  if (job.remote === true) bonus += 1;

  const total = Math.max(0, Math.min(roleScore + locScore + bonus, 100));
  return { score: Math.round(total), eligibility, offTarget, breakdown: { roleScore, locScore, bonus } };
}

// ============================================================
// HELPERS (unchanged surface)
// ============================================================
export function getAliasesForCluster(cluster) {
  const e = ROLE_TAXONOMY.find((x) => x.cluster === cluster);
  return e ? e.aliases : [];
}

export function classifyJob(title = "", description = "") {
  // TITLE-FIRST: the job title is authoritative. A "Cloud Support Engineer" is an
  // engineer even if its description says "customer" 20 times. We only consult the
  // description when the title alone yields no cluster (e.g. "Member Happiness Hero").
  const titleDet = detectCluster(title);
  let cluster = titleDet.cluster;
  if (!cluster) {
    const bodyDet = detectCluster(`${title} ${description}`);
    cluster = bodyDet.cluster;
  }
  if (cluster) {
    const e = ROLE_TAXONOMY.find((x) => x.cluster === cluster);
    return { role_cluster: cluster, department: e ? e.department : "Other" };
  }
  return { role_cluster: "Other", department: "Other" };
}

// expose detector for tests / tooling
export { detectCluster };