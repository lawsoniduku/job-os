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
    related: ["HR Generalist / HRBP", "Data Analytics", "Performance Management"],
    aliases: [
      "people analytics","people analyst","hr analyst","hr data analyst",
      "workforce analyst","workforce analytics","workforce insights",
      "hris analyst","hris specialist","hr systems analyst",
      "people data analyst","people insights analyst","talent analytics",
      "people operations analyst","hr reporting analyst","hr business intelligence",
      "compensation analyst","total rewards analyst","hr metrics analyst",
      "org design analyst","people science","hr technology analyst",
      // creative internal titles companies actually use for this role
      "people research analyst","human capital analyst","talent science",
      "hr analytics specialist","organizational insights analyst",
      "employee experience analyst","performance analytics analyst",
      "talent insights analyst","workforce intelligence analyst",
      "talent analytics analyst","organizational development analyst"
    ],
    keywords: ["hris","workday","bamboohr","successfactors","people data",
      "hr dashboard","workforce planning","headcount","attrition","org chart","hr kpi"]
  },
  {
    cluster: "Talent Acquisition",
    department: "HR",
    aliases: [
      "talent acquisition","recruiter","talent partner","sourcer",
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
    related: ["People Analytics", "Talent Acquisition", "Performance Management"],
    aliases: [
      "human resources","human resource","hr generalist","hr business partner","hrbp","hr manager",
      "hr coordinator","hr advisor","hr consultant","hr associate",
      "people partner","people manager","people operations",
      "people ops manager","people ops specialist","hr operations",
      "hr ops","hr administrator","hr assistant","hr officer",
      "employee relations","employee experience","people experience",
      "hr lead","head of people","vp people","chief people officer",
      "learning and development","l&d specialist","training specialist",
      "organisational development","od specialist",
      // strategic-partner + generalist variants
      "people business partner","hr strategic partner","people generalist",
      "hr specialist","people operations generalist","people relations partner",
      "employee relations business partner"
    ],
    keywords: ["onboarding","offboarding","performance management","engagement",
      "hr policies","employment law","payroll","benefits","culture","dei"]
  },
  {
    cluster: "Performance Management",
    department: "HR",
    related: ["People Analytics", "HR Generalist / HRBP"],
    aliases: [
      "performance management","performance manager","performance analyst","people performance analyst",
      "talent performance analyst","performance management specialist",
      "performance and reward analyst","performance systems analyst"
    ],
    keywords: ["performance review","okrs","360 feedback","calibration",
      "performance cycle","goal setting","talent review","succession planning"]
  },
  {
    cluster: "Data Analytics",
    department: "Data",
    aliases: [
      "data analytics","business intelligence","data analyst","business intelligence analyst","bi analyst",
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
      "data science","machine learning","data scientist","machine learning engineer","ml engineer",
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
      "data engineering","data engineer","analytics engineer","etl developer","etl engineer",
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
      "software engineering","software development","software engineer","software developer","backend engineer",
      "backend developer","frontend developer","front end developer",
      "full stack developer","fullstack developer","ui engineer",
      "frontend engineer","full stack engineer","fullstack engineer",
      "web developer","mobile developer","ios developer","android developer",
      "react developer","node developer","python developer","java developer",
      "android engineer","ios engineer","mobile engineer","backend api engineer",
      "api engineer","embedded engineer","firmware engineer",
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
      "product management","product manager","product owner","associate product manager",
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
      "customer success","customer success manager","csm","customer success specialist",
      "account manager","key account manager","strategic account manager",
      "client success manager","client relationship manager",
      "client partner","partner success manager","customer engagement manager",
      "customer experience manager","cx manager","renewal manager",
      "customer success lead","head of customer success","vp customer success",
      "enterprise account manager"
    ],
    keywords: ["churn","nps","customer retention","upsell","cross-sell",
      "renewal","qbr","customer health score","crm","salesforce","hubspot"]
  },
  {
    cluster: "Customer Support",
    department: "Operations",
    aliases: [
      "customer support","contact centre","contact center","call centre","call center","customer service","support specialist",
      "support agent","support representative","customer care",
      "customer care agent","cx specialist","cx agent",
      "technical support","tier 1 support","tier 2 support",
      "help desk","helpdesk","service desk",
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
      "remote assistant","online assistant","executive assistant remote","administrative assistant remote","scheduling coordinator","calendar manager"
    ],
    keywords: ["calendar management","scheduling","travel booking",
      "inbox management","expense reports","google workspace","microsoft 365","notion","asana"]
  },
  {
    cluster: "Digital Marketing",
    department: "Marketing",
    aliases: [
      "digital marketing","brand management","digital marketing manager","marketing manager","growth marketer",
      "performance marketer","paid media specialist","paid search specialist",
      "seo specialist","seo manager","sem specialist","ppc specialist",
      "social media manager","social media specialist","social media coordinator",
      "content marketing manager","content strategist","content writer",
      "copywriter","email marketing specialist","crm specialist",
      "brand manager","brand strategist","community manager",
      "influencer marketing manager","affiliate marketing manager",
      "demand generation manager","demand generation","digital marketer","lifecycle marketing manager",
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
      "strategy consultant","process improvement specialist",
      "lean specialist","six sigma",
      "branch operations manager","area manager"
    ],
    keywords: ["process","efficiency","kpi","metrics","jira","confluence",
      "asana","monday.com","notion","okrs","reporting"]
  },
  {
    cluster: "Finance",
    department: "Finance",
    aliases: [
      "finance manager","financial controller","controller",
      "payroll specialist","treasury analyst",
      "fp&a","fp&a analyst","financial planning analyst",
      "financial analyst","finance analyst","investment analyst",
      "risk analyst","credit analyst","fraud analyst","revenue analyst",
      "budget analyst","tax specialist","tax analyst",
      "chief financial officer","cfo","vp finance","head of finance"
    ],
    keywords: ["ifrs","gaap","quickbooks","xero","sap","oracle",
      "forecasting","budgeting","p&l","balance sheet","cash flow"]
  },
  {
    cluster: "Design / UX",
    department: "Design",
    aliases: [
      "user experience","product design","ux designer","ui designer","ui/ux designer","ux/ui designer","product designer",
      "interaction designer","visual designer","graphic designer",
      "brand designer","web designer","motion designer",
      "ux researcher","user researcher","design researcher",
      "art director","creative director","design director",
      "design lead","head of design","design manager","senior designer"
    ],
    keywords: ["figma","sketch","adobe xd","prototyping","wireframing",
      "user testing","design system","accessibility"]
  },
  {
    cluster: "Sales",
    department: "Sales",
    aliases: [
      "business development","sales development representative","sdr","sales executive","business development representative",
      "bdr","account executive","ae","enterprise sales","b2b sales",
      "inside sales","outside sales","field sales","sales manager",
      "sales director","vp sales","chief revenue officer","cro",
      "revenue operations","revops","sales operations",
      "business development manager","commercial manager","regional sales manager"
    ],
    keywords: ["salesforce","hubspot","outreach","salesloft","cold calling",
      "pipeline","quota","arr","mrr","deal closing","prospecting"]
  },
  {
    cluster: "Solutions Architecture / Pre-Sales",
    department: "Sales",
    aliases: [
      "solutions architect","solution architect","solutions engineer","pre-sales engineer",
      "presales engineer","sales engineer","technical account manager","solutions consultant",
      "implementation consultant","implementation manager","integration consultant",
      "partner development manager","partnerships manager","alliances manager",
      "channel manager","solutions specialist","solution specialist","solution lead",
      "network solution lead","enterprise architect","cloud solutions architect",
      "principal architect","solutions architecture","customer solutions engineer",
      "field engineer (sales)","deployment engineer","onboarding engineer"
    ],
    keywords: ["pre-sales","presales","solution design","poc","proof of concept",
      "technical demo","rfp","customer onboarding","architecture","integration","partnerships"]
  },
  {
    cluster: "Accounting / Audit",
    department: "Finance",
    aliases: [
      "accounts receivable","account receivable","accounts payable","account payable","accountant","chartered accountant","staff accountant","senior accountant",
      "account officer","accounts officer","accounts payable","accounts receivable",
      "bookkeeper","auditor","internal auditor","external auditor","audit manager",
      "audit associate","tax accountant","cost accountant","management accountant",
      "financial accountant","accounting manager","accounting officer","account executive (finance)",
      "accounts clerk","accounting clerk","payroll accountant","reconciliation officer"
    ],
    keywords: ["ledger","reconciliation","trial balance","journal entries","audit",
      "icai","ican","acca","cpa","financial statements","vat","tax returns"]
  },
  {
    cluster: "Healthcare / Medical",
    department: "Healthcare",
    aliases: [
      "nurse","registered nurse","nursing officer","midwife","doctor","physician",
      "medical officer","medical doctor","house officer","clinical officer",
      "pharmacist","pharmacy technician","lab scientist","laboratory scientist",
      "medical laboratory scientist","radiographer","physiotherapist","dentist",
      "dental surgeon","optometrist","health officer","public health officer",
      "community health worker","clinical pharmacist","matron","caregiver","care assistant",
      "health records officer","nutritionist","dietitian","medical sales representative"
    ],
    keywords: ["patient care","clinical","diagnosis","treatment","ward","icu",
      "phlebotomy","pharmacology","mbbs","nursing","medical","hospital"]
  },
  {
    cluster: "Civil / Mechanical / Electrical Engineering",
    department: "Engineering (Physical)",
    aliases: [
      "civil engineer","structural engineer","mechanical engineer","electrical engineer",
      "electronics engineer","chemical engineer","petroleum engineer","mining engineer",
      "industrial engineer","production engineer","maintenance engineer","project engineer",
      "site engineer","field engineer","quantity surveyor","building engineer",
      "hvac engineer","instrumentation engineer","process engineer","quality engineer",
      "automotive engineer","marine engineer","geotechnical engineer","water engineer",
      "biomedical engineer","telecom engineer","rf engineer","power engineer","facilities engineer"
    ],
    keywords: ["autocad","solidworks","construction","hse","maintenance","cad",
      "piping","fabrication","commissioning","plant","drilling","survey"]
  },
  {
    cluster: "Education / Teaching",
    department: "Education",
    aliases: [
      "teacher","lecturer","tutor","instructor","professor","assistant professor",
      "teaching assistant","school teacher","primary teacher","secondary teacher",
      "subject teacher","head teacher","headmaster","headmistress","principal",
      "academic coordinator","education officer","curriculum developer","education consultant",
      "trainer","corporate trainer","exam invigilator","school administrator","dean","registrar (education)"
    ],
    keywords: ["curriculum","lesson plan","classroom","pedagogy","students","syllabus",
      "teaching","academic","e-learning","grading","tutoring"]
  },
  {
    cluster: "Legal",
    department: "Legal",
    aliases: [
      "lawyer","legal officer","legal counsel","corporate counsel","in-house counsel",
      "attorney","solicitor","barrister","legal associate","legal advisor",
      "legal assistant","paralegal","company secretary","legal manager","head of legal",
      "general counsel","compliance officer","compliance manager","contracts manager",
      "legal analyst","litigation associate","legal practitioner",
      "commercial counsel","tax counsel","privacy counsel","employment counsel"
    ],
    keywords: ["contracts","litigation","compliance","regulatory","due diligence",
      "legal advice","corporate law","drafting","negotiation","statutory"]
  },
  {
    cluster: "Admin / Office Support",
    department: "Administration",
    aliases: [
      "administrative officer","admin officer","admin assistant","administrative assistant",
      "office administrator","office manager","office assistant","receptionist",
      "front desk officer","secretary","personal assistant","executive assistant",
      "data entry officer","data entry clerk","clerk","office clerk","filing clerk",
      "administrative coordinator","facilities officer","front office executive","office coordinator"
    ],
    keywords: ["scheduling","filing","correspondence","office management","minutes",
      "calendar","reception","clerical","administrative support"]
  },
  {
    cluster: "Supply Chain / Logistics",
    department: "Operations",
    aliases: [
      "supply chain","supply chain officer","supply chain manager","logistics officer","logistics manager",
      "procurement officer","procurement manager","purchasing officer","buyer",
      "warehouse officer","warehouse manager","inventory officer","inventory manager",
      "store keeper","storekeeper","fleet officer","fleet manager","distribution officer",
      "import export officer","customs officer","shipping officer","dispatch officer",
      "demand planner","supply planner","materials manager","logistics coordinator"
    ],
    keywords: ["procurement","inventory","warehouse","supply chain","logistics",
      "shipping","freight","distribution","sourcing","fleet","stock"]
  },
  {
    cluster: "Banking / Financial Services",
    department: "Finance",
    aliases: [
      "relationship manager","banking officer","bank teller","teller","branch manager",
      "credit officer","loan officer","mortgage officer","investment banker",
      "wealth manager","portfolio manager","retail banking officer","corporate banking officer",
      "treasury officer","trade finance officer","banking operations officer","cashier",
      "personal banker","business banker","account relationship manager","banking analyst"
    ],
    keywords: ["banking","loans","deposits","credit","kyc","aml","branch",
      "retail banking","corporate banking","treasury","financial services"]
  },
  {
    cluster: "Content / Writing",
    department: "Marketing",
    aliases: [
      "content writer","copywriter","brand copywriter","content creator","content strategist",
      "editor","copy editor","proofreader","technical writer","blog writer",
      "content manager","content marketer","journalist","reporter","scriptwriter",
      "social media writer","seo writer","content producer","communications officer",
      "communications manager","pr officer","public relations officer"
    ],
    keywords: ["content","copywriting","editing","blog","seo content","storytelling",
      "publishing","editorial","communications","press release"]
  },
  {
    cluster: "Project / Program Management",
    department: "Operations",
    aliases: [
      "project management","program management","project manager","program manager","programme manager","project coordinator",
      "project lead","project officer","scrum master","agile coach","delivery manager",
      "project director","pmo","project management officer","portfolio manager (projects)",
      "technical program manager","implementation manager","change manager"
    ],
    keywords: ["project management","pmp","prince2","agile","scrum","gantt",
      "stakeholder","milestones","deliverables","kanban","budget"]
  },
  {
    cluster: "Skilled Trades / Field",
    department: "Operations",
    aliases: [
      "electrician","plumber","welder","mechanic","technician","driver","calibration engineer",
      "security guard","cleaner","janitor","cook","chef",
      "waiter","waitress","tailor","carpenter","painter","generator technician",
      "field technician","maintenance technician","installation technician","ac technician",
      "machine operator","factory worker","production operator","forklift operator"
    ],
    keywords: ["repair","installation","maintenance","technical","manual",
      "equipment","machinery","hands-on","field work"]
  },

  // ============================================================
  // BROAD-MARKET CLUSTERS (added after taxonomy coverage audit)
  // ============================================================
  // The original taxonomy was built for the global remote-tech market
  // (Software Engineering had 56 aliases; General Management had none).
  // A coverage audit against real Nigerian job titles found only 30% had
  // ANY taxonomy home — so 70% fell through to body classification, which
  // is a fallback path, not a primary one. That fallback is where every
  // false positive came from ("the company operates a performance
  // management system" hijacking a General Manager posting).
  //
  // These 7 clusters close the front-door gap. Title-first can now carry
  // the confidence it was designed to carry. They also fix bare-noun
  // misfires for free: a specific multi-word alias scores ~100
  // (40 + words*12 + length) vs a bare noun's 30, so specificity wins
  // automatically — the aliases just had to exist.
  {
    cluster: "Executive / General Management",
    department: "Executive",
    related: ["Operations", "Strategy / Business Development"],
    aliases: [
      "chief executive officer","chief operating officer","chief of staff",
      "managing director","deputy managing director","executive director",
      "general manager","deputy general manager","assistant general manager",
      "country manager","country director","city manager","regional manager",
      "regional business manager","regional director","business unit head",
      "head of business","business manager","divisional head","group head",
      "chief commercial officer","chief business officer","chief strategy officer",
      "vice president operations","md/ceo","gm operations",
    ],
    keywords: ["p&l","board","governance","strategic direction","business unit",
      "executive leadership","organisational strategy","stakeholder management"]
  },
  {
    cluster: "Security",
    department: "Security",
    related: ["Skilled Trades / Field", "Operations"],
    aliases: [
      "security officer","security supervisor","security manager","head of security",
      "chief security officer","security coordinator","security analyst",
      "security specialist","loss prevention officer","loss prevention manager",
      "physical security manager","corporate security manager","security consultant",
      "safety and security officer","security operations manager","cso",
    ],
    keywords: ["surveillance","access control","incident response","patrol",
      "risk assessment","cctv","guard force","security protocol"]
  },
  {
    cluster: "Quality Assurance",
    department: "Quality",
    related: ["Operations", "Civil / Mechanical / Electrical Engineering"],
    aliases: [
      "quality assurance manager","quality assurance officer","quality assurance analyst",
      "quality assurance specialist","quality assurance supervisor","quality assurance lead",
      "quality control officer","quality control manager","quality control analyst",
      "quality control inspector","quality manager","quality officer","quality analyst",
      "quality inspector","quality auditor","qa officer","qa manager","qa analyst",
      "qa specialist","qc analyst","qc officer","qc inspector",
      "service quality assurance manager","quality systems manager",
    ],
    keywords: ["iso 9001","haccp","gmp","quality standards","inspection",
      "non-conformance","audit trail","quality control","defect","compliance testing"]
  },
  {
    cluster: "Monitoring & Evaluation / Programmes",
    department: "Development / NGO",
    related: ["Project / Program Management", "Data Analytics"],
    aliases: [
      "monitoring and evaluation officer","monitoring and evaluation manager",
      "monitoring and evaluation specialist","monitoring evaluation and learning",
      "m&e officer","m&e manager","m&e specialist","m&e coordinator",
      "meal officer","meal manager","meal coordinator",
      "programme officer","program officer","programme manager",
      "programme coordinator","program coordinator","programme assistant",
      "grants officer","grants manager","field coordinator",
      "field officer","community mobilisation officer","development officer",
      "impact assessment officer","research and learning officer",
    ],
    keywords: ["logframe","theory of change","indicators","baseline survey",
      "donor reporting","beneficiaries","ngo","development sector","grant",
      "impact measurement"]
  },
  {
    cluster: "Retail / Hospitality",
    department: "Retail / Hospitality",
    related: ["Operations", "Sales", "Customer Support"],
    aliases: [
      "store manager","head of store","assistant store manager","shop manager",
      "outlet manager","assistant outlet manager",
      "retail manager","retail supervisor","floor manager","showroom manager","showroom","franchise manager","retail showroom",
      "hotel manager","assistant hotel manager","front desk manager",
      "restaurant manager","assistant restaurant manager","food and beverage manager",
      "service center supervisor","service centre supervisor","service centre manager",
      "guest relations manager","housekeeping supervisor","duty manager",
      "retail operations manager","merchandiser","visual merchandiser",
    ],
    keywords: ["footfall","pos","stock take","shrinkage","guest experience",
      "front of house","occupancy","menu","retail outlet","customer footfall"]
  },
  {
    cluster: "HSE / Sustainability",
    department: "HSE",
    related: ["Civil / Mechanical / Electrical Engineering", "Operations"],
    aliases: [
      "hse officer","hse manager","hse supervisor","hse coordinator","hse advisor",
      "ehs manager","ehs officer","ehs coordinator",
      "health safety and environment officer","health safety and environment manager",
      "health and safety officer","health and safety manager","safety officer",
      "safety manager","safety coordinator","environmental officer",
      "environmental manager","environmental specialist",
      "sustainability manager","sustainability officer","sustainability analyst",
      "sustainability lead","esg analyst","esg manager","esg officer",
      "occupational health officer",
    ],
    keywords: ["hse","ehs","iso 14001","ohsas","risk assessment","permit to work",
      "toolbox talk","incident reporting","esg","carbon","emissions","sustainability report"]
  },
  {
    cluster: "Strategy / Business Development",
    department: "Strategy",
    related: ["Executive / General Management", "Sales", "Operations"],
    aliases: [
      "strategy analyst","strategy manager","strategy associate","strategy lead",
      "corporate strategy manager","corporate strategy analyst",
      "business strategy manager","strategic planning manager",
      "business transformation officer","business transformation manager",
      "business transformation lead","transformation manager",
      "corporate development manager","corporate development associate",
      "commercial analyst",
      "strategic partnerships manager","head portfolio value creation",
      "value creation manager","market expansion manager","growth strategy manager",
    ],
    keywords: ["market entry","competitive analysis","business case","go-to-market",
      "strategic initiative","partnership","due diligence","market sizing",
      "value creation","transformation roadmap"]
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
  qa: "Software Engineering", sre: "Software Engineering", devops: "Software Engineering", swe: "Software Engineering",
  ml: "Data Science", ai: "Data Science", nlp: "Data Science",
  ba: "Data Analytics", bi: "Data Analytics",
  etl: "Data Engineering", dba: "Data Engineering",
  sdr: "Sales", bdr: "Sales", ae: "Sales", revops: "Sales",
  cs: "Customer Success", csm: "Customer Success",
  va: "Virtual Assistant", ea: "Virtual Assistant", pa: "Virtual Assistant",
  seo: "Digital Marketing", sem: "Digital Marketing", ppc: "Digital Marketing", smm: "Digital Marketing",
  fpa: "Finance", "fp&a": "Finance",
  // new broad-market short tokens
  pmp: "Project / Program Management", pmo: "Project / Program Management",
  rn: "Healthcare / Medical",
};

// Bare role nouns: lower weight than a full alias, but enough to route
// "product roles", "design jobs", "sales position".
const BARE_NOUN_HINTS = {
  product: "Product Management",
  design: "Design / UX", designer: "Design / UX",
  sales: "Sales", selling: "Sales",
  marketing: "Digital Marketing",
  finance: "Finance",
  operations: "Operations", ops: "Operations",
  // NOTE: bare "support" was removed as a hint — it's far too broad. "IT Support",
  // "Business Support", "Field Support", "Inventory Support", "Application Support"
  // are NOT customer service. The Customer Support cluster's specific aliases
  // ("customer support", "technical support", "help desk", "support agent", etc.)
  // already catch genuine customer-service roles without these false positives.
  recruiter: "Talent Acquisition", recruiting: "Talent Acquisition", recruitment: "Talent Acquisition",
  developer: "Software Engineering",
  analyst: "Data Analytics", analytics: "Data Analytics", data: "Data Analytics",
  // new broad-market bare nouns
  nurse: "Healthcare / Medical", nursing: "Healthcare / Medical", medical: "Healthcare / Medical",
  doctor: "Healthcare / Medical", pharmacist: "Healthcare / Medical",
  teacher: "Education / Teaching", teaching: "Education / Teaching", lecturer: "Education / Teaching",
  lawyer: "Legal", legal: "Legal", paralegal: "Legal",
  accountant: "Accounting / Audit", accounting: "Accounting / Audit", auditor: "Accounting / Audit",
  procurement: "Supply Chain / Logistics", logistics: "Supply Chain / Logistics", warehouse: "Supply Chain / Logistics",
  receptionist: "Admin / Office Support", secretary: "Admin / Office Support", administrative: "Admin / Office Support",
  banking: "Banking / Financial Services", teller: "Banking / Financial Services",
  electrician: "Skilled Trades / Field", plumber: "Skilled Trades / Field",
  driver: "Skilled Trades / Field", technician: "Skilled Trades / Field",
  // NOTE: bare "engineer" intentionally removed — it forced civil/mechanical/etc.
  // into Software Engineering. Specific aliases ("civil engineer", "software
  // engineer") now decide via specificity scoring instead.
};

// ============================================================
// CLUSTER DETECTION — score-based, longest/most-specific wins
// ============================================================
// Build the text variants a title should be matched against.
//
// WHY: multinational and Nigerian corporate postings routinely INVERT titles —
// "Manager, Customer Success", "Head, Human Resources", "Lead, Data Engineering"
// — while the taxonomy stores the natural order ("customer success manager").
// A pure substring match never fires on the inverted form, so the title falls
// through to body classification (the fallback path that caused every false
// positive). Rather than doubling 695 aliases with inverted duplicates, we
// normalise the QUERY instead: strip trailing qualifiers, then swap around the
// comma/colon so "Manager, Customer Success" also gets tested as
// "Customer Success Manager".
function titleVariants(raw) {
  const variants = [raw];
  // Drop parenthetical qualifiers — "(B2B Retention)", "(SQA)", "(Private
  // Security)" sit between the role words and break adjacency after swapping.
  const noParens = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (noParens && noParens !== raw) variants.push(noParens);
  // Swap around the FIRST comma or colon: "Manager, Customer Success" ->
  // "Customer Success Manager". Only when both sides are short enough to be a
  // title (guards against swapping a sentence).
  const m = noParens.match(/^([^,:]{2,40})[,:]\s*(.{2,60})$/);
  if (m) {
    const swapped = `${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, " ");
    variants.push(swapped);
  }
  return variants;
}

function detectCluster(query) {
  // Normalize separators: slashes, pipes, commas, parens become spaces so
  // titles like "Backend / API Engineer, Billing" match cleanly. Collapse
  // whitespace and pad so boundary regexes work at the edges.
  const raw = String(query);
  const norm = (s) => ` ${s.toLowerCase().replace(/[\/|,()\[\]{}]+/g, " ").replace(/\s+/g, " ")} `;
  // Only build inverted variants for short, title-like input — never for a full
  // job description (which is long and would make the swap meaningless, plus
  // triple the regex work on the hot path).
  const useVariants = raw.length <= 90 && /[,:]/.test(raw);
  const queries = useVariants ? titleVariants(raw).map(norm) : [norm(raw)];
  const q = queries[0]; // primary/original form
  // hasPhrase across ANY variant — the inverted form is the same title.
  const inAny = (phrase) => queries.some((qq) => hasPhrase(qq, phrase));
  const scores = {};
  // matchedPhrases: EVERY distinct phrase that matched, from ALL signal types
  // (aliases, short tokens, bare nouns, AND keywords) together. This matters:
  // keywords often SUBSTRING their own cluster's aliases (e.g. "process" is a
  // substring of the alias "process improvement specialist"), so counting
  // keyword hits separately from alias hits let one physical mention pass as
  // two independent signals. One dedup pass across everything closes that.
  const matchedPhrases = {};
  const bump = (c, n, phrase) => {
    if (!c) return;
    scores[c] = Math.max(scores[c] || 0, n);
    (matchedPhrases[c] = matchedPhrases[c] || []).push(phrase);
  };
  const add = (c, n, phrase) => {
    if (!c) return;
    scores[c] = (scores[c] || 0) + n;
    (matchedPhrases[c] = matchedPhrases[c] || []).push(phrase);
  };

  // 1. Multi-word / long aliases — strongest signal, weighted by specificity
  for (const entry of ROLE_TAXONOMY) {
    for (const alias of entry.aliases) {
      if (alias.length < 4) continue; // very short aliases handled below
      if (inAny(alias)) {
        const specificity = alias.split(/\s+/).length * 12 + alias.length; // longer = better
        bump(entry.cluster, 40 + specificity, alias);
      }
    }
  }
  // 2. Curated short tokens (hr, pm, ux, qa...)
  for (const [tok, cluster] of Object.entries(SHORT_TOKENS)) {
    if (inAny(tok)) bump(cluster, 38, tok);
  }
  // 3. Bare role nouns (product, design, sales...)
  for (const [noun, cluster] of Object.entries(BARE_NOUN_HINTS)) {
    if (inAny(noun)) bump(cluster, 30, noun);
  }
  // 4. Skill keywords — additive nudges; skip <3 chars so "r"/"ai" can't dominate
  for (const entry of ROLE_TAXONOMY) {
    for (const kw of entry.keywords) {
      if (kw.length < 3) continue;
      if (inAny(kw)) add(entry.cluster, 4, kw);
    }
  }

  // De-duplicate nested/overlapping phrases per cluster: if phrase A is a
  // substring of phrase B (both matched for the same cluster), A is the same
  // physical mention as B, not independent evidence — drop it. What survives
  // is the count of genuinely DISTINCT things this text says about the role.
  const distinctSignals = {};
  for (const [c, phrases] of Object.entries(matchedPhrases)) {
    const unique = [...new Set(phrases)];
    const kept = unique.filter((p, i) =>
      !unique.some((other, j) => i !== j && (other.length > p.length || (other.length === p.length && j < i)) && other.includes(p))
    );
    distinctSignals[c] = kept.length;
  }

  let best = null, bestScore = 0;
  for (const [c, s] of Object.entries(scores)) {
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best
    ? { cluster: best, score: bestScore, distinctSignals: distinctSignals[best] || 0, all: scores }
    : { cluster: null, score: 0, distinctSignals: 0, all: {} };
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
  "work from anywhere", "remote (work from anywhere)", "work from anywhere)",
  "fully remote worldwide", "remote worldwide", "globally remote", "remote, anywhere",
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
  "united states", "usa", "u.s.", "united kingdom", "uk", "u.k.", "canada", "germany", "france",
  "spain", "italy", "netherlands", "ireland", "poland", "portugal", "romania",
  "bulgaria", "serbia", "ukraine", "greece", "turkey", "hungary", "austria",
  "belgium", "denmark", "norway", "finland", "switzerland", "sweden",
  "india", "china", "japan", "singapore", "australia", "new zealand", "brazil",
  "mexico", "argentina", "colombia", "philippines", "pakistan", "bangladesh",
  "vietnam", "indonesia", "malaysia", "thailand", "uae", "saudi arabia", "qatar",
];

// ============================================================
// TIMEZONE REQUIREMENT DETECTION (soft eligibility signal)
// ============================================================
// A JD can be "remote, worldwide" yet still demand overlap with a timezone
// that effectively excludes Africa (e.g. "must work US Pacific hours"). This
// is a real friction African applicants hit AFTER applying — so we surface it.
// It is a SOFT signal: it downgrades confidence and warns, rather than hard-
// excluding, because some overlap requirements are workable (Africa is UTC+0
// to UTC+3, so CET/UK/EMEA overlap is fine; US Pacific/Eastern is not).

// Timezones that are HARD for Africa (little/no business-hours overlap).
// Africa spans UTC+0..+3, so GMT/UTC/CET/UK/EMEA/WAT/CAT/EAT overlap fine and
// are deliberately NOT listed — only genuinely incompatible zones are.
const TZ_INCOMPATIBLE = [
  "pst", "pdt", "pacific time", "pacific standard", "pacific daylight", "us pacific",
  "mst", "mdt", "mountain time", "us mountain",
  "cst", "cdt", "central time", "us central",
  "est", "edt", "eastern time", "eastern standard", "us eastern",
  "america/los_angeles", "america/new_york", "america/chicago", "america/denver",
  "aest", "aedt", "australian eastern", "sydney time", "melbourne time",
  "nzst", "new zealand time",
];

// Phrasing that signals a timezone REQUIREMENT (checked NEAR the tz mention).
const TZ_REQUIRE_CUES = [
  "must be available", "must work", "must overlap", "required to work",
  "work during", "available during", "core hours", "overlap with", "overlap",
  "business hours", "working hours", "within", "hours of", "time zone",
  "timezone", "required", "must be", "must reside", "based in",
];

// Explicit flexibility anywhere in the posting cancels the warning.
const TZ_FLEX = [
  "flexible hours", "flexible timezone", "flexible time zone", "async",
  "asynchronous", "no set hours", "work anytime", "any timezone", "any time zone",
  "timezone friendly", "timezone flexible", "flexible schedule",
];

/**
 * Timezone friction for Africa-based applicants.
 *   null   → no incompatible-timezone REQUIREMENT found
 *   "warn" → the posting requires hours in a timezone that's hard from Africa
 *
 * Design (audited):
 * - Word-boundary regex per timezone token — "est" can NEVER match inside
 *   "latest"/"best"/"request". (An earlier draft had a substring fallback that
 *   did exactly that; removed.)
 * - PROXIMITY REQUIRED: a requirement cue must appear within ±80 chars of the
 *   timezone mention (same window technique as bodyTiesToForeignCountry).
 *   "Our HQ is in EST" with "business hours" three paragraphs away does NOT
 *   trigger; "must overlap with EST business hours" does.
 * - Explicit flexibility ("async", "flexible timezone") cancels globally.
 */
function timezoneFriction(title, desc) {
  const body = ` ${title} ${desc} `;
  if (TZ_FLEX.some((f) => body.includes(f))) return null;

  for (const tz of TZ_INCOMPATIBLE) {
    // All word-boundary occurrences of this timezone token.
    const re = new RegExp(`(?<![a-z0-9])${tz.replace(/[/\\^$.*+?()[\]{}|]/g, "\\$&")}(?![a-z0-9])`, "g");
    let m;
    while ((m = re.exec(body)) !== null) {
      const windowText = body.slice(Math.max(0, m.index - 80), m.index + tz.length + 80);
      if (TZ_REQUIRE_CUES.some((cue) => windowText.includes(cue))) return "warn";
    }
  }
  return null;
}

// ============================================================
// ELIGIBILITY ENGINE
// ============================================================

// On-site location hints for major non-African hiring hubs — used ONLY on the
// short location field, where a bare "US" or "New York" is unambiguous.
const LOC_FOREIGN_HINTS = [
  ...FOREIGN_COUNTRIES, "us",
  "new york", "san francisco", "austin", "seattle", "boston", "chicago",
  "los angeles", "denver", "atlanta", "miami", "washington dc",
  "toronto", "vancouver", "montreal", "dublin", "amsterdam", "sydney", "melbourne",
];

/**
 * Eligibility when we DON'T know the user's country (guest, no profile).
 * The product's audience is Africa-first, so the default gate is:
 * exclude anything restricted or clearly on-site abroad; pass worldwide,
 * remote, and Africa-located roles; be honest about the rest.
 */
function genericEligibility(job, title, desc) {
  const locField = ` ${(job.location || "").toLowerCase()} `;
  const body = ` ${title} ${desc.slice(0, 3000)} `;

  // 1. Explicit restrictions anywhere -> out.
  if (hasAny(locField, HARD_EXCLUSIONS) || hasAny(body, HARD_EXCLUSIONS))
    return { eligible: false, confidence: "excluded", reason: "Geographically restricted" };
  if (RESTRICTION_PHRASES.some((p) => hasPhrase(body, p)))
    return { eligible: false, confidence: "excluded", reason: "Restricted to a specific region in the posting" };

  const remoteSignal = job.remote === true ||
    hasAny(`${locField}${body}`, ["remote", "work from home", "wfh", "work from anywhere", "fully distributed"]);

  // Guests default to the Africa-first audience, so incompatible-timezone
  // REQUIREMENTS are a real friction — warn on otherwise-open roles.
  const tzWarn = timezoneFriction(title, desc.slice(0, 3000));
  const openReason = (base) => tzWarn
    ? `${base} — but needs a timezone that's hard from Africa; check the hours`
    : base;

  // 2. Location field pins it to a foreign hub.
  if (hasAny(locField, LOC_FOREIGN_HINTS)) {
    if (!remoteSignal)
      return { eligible: false, confidence: "excluded", reason: `On-site in ${job.location} — not open to applicants elsewhere` };
    return { eligible: true, confidence: "possible", reason: `Remote, but tied to ${job.location} — confirm it's open to your country` };
  }

  // 3. Clearly open.
  if (hasAny(locField, ["anywhere", "worldwide", "global"]) || hasAny(locField, AFRICA_TERMS))
    return { eligible: true, confidence: tzWarn ? "possible" : "likely", reason: openReason("Open worldwide / Africa") };
  if (remoteSignal)
    return { eligible: true, confidence: tzWarn ? "possible" : "likely", reason: openReason("Remote role") };

  // 4. Unpinned local/unknown — honest conditional.
  return { eligible: true, confidence: "possible", reason: "Set your country in You → for a verified check" };
}

/**
 * checkEligibility(job, country) -> { eligible, confidence, reason }
 * confidence: certain | likely | possible | excluded
 * Word-boundary matching throughout (fixes "campus only"/"remote user" bugs).
 */
export function checkEligibility(job, country) {
  // Some scraped descriptions lose their spaces ("Data AnalystLocation : Remote,
  // UKFull-time"). Insert spaces at word boundaries BEFORE lowercasing so glued
  // words separate and word-boundary matching works:
  //   - lower→Upper:        "AnalystLocation" -> "Analyst Location"
  //   - UPPER→Upperlower:   "UKFull"          -> "UK Full"  (acronym + word)
  const deglue = (s) =>
    String(s || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const title = ` ${deglue(job.title).toLowerCase()} `;
  const loc = deglue(job.location).toLowerCase();
  const desc = deglue(job.description).toLowerCase();
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

  // Timezone friction: for Africa/EMEA-adjacent targets, an incompatible-tz
  // REQUIREMENT downgrades an otherwise-positive verdict and warns. Computed
  // once here; applied to positive verdicts via softenForTimezone below.
  const tzWarn = (isAfrican || country === "mena" || country === "africa")
    ? timezoneFriction(title, desc) : null;
  const softenForTimezone = (verdict) => {
    if (!tzWarn || !verdict.eligible) return verdict;
    // Never upgrade; only downgrade certain/likely → possible with a warning.
    if (verdict.confidence === "certain" || verdict.confidence === "likely") {
      return E("possible", `${verdict.reason} — but requires a timezone that's hard from Africa; confirm hours before applying`);
    }
    return verdict;
  };

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

  // 1e. Non-English DESCRIPTION → drop, even if the location field says "Anywhere".
  // Catches local-market roles (e.g. Brazilian/Mexican companies posting in
  // Portuguese/Spanish) that mislabel their location as worldwide. We detect by
  // (a) Portuguese/Spanish marker words, or (b) heavy diacritic density.
  const NON_EN_DESC = [
    "estamos","nossa","nosso","você","trabalho","empresa","vaga","vagas","sobre",
    "experiência","conhecimento","atuar","responsável","equipe","desenvolvimento",
    "nuestra","nuestro","buscamos","trabajo","empresa","experiencia","conocimiento",
    "responsable","equipo","habilidades","requisitos","ofrecemos","únete",
  ];
  let nonEnHits = 0;
  for (const w of NON_EN_DESC) if (hasPhrase(desc, w)) nonEnHits++;
  const diac = (desc.match(/[àâãäçéêíóôõúñ]/g) || []).length;
  const diacRatio = diac / Math.max(desc.length, 1);
  if (nonEnHits >= 3 || diacRatio > 0.015) {
    return E("excluded", "Non-English posting (local-market role)", false);
  }

  // 1f. Body ties the role to a SPECIFIC foreign country (and the user isn't
  // targeting it) → overrides a "worldwide" location field. Real postings phrase
  // this many ways ("based in X", "Location: Remote, UK", "Headquarters: Mexico…
  // Mexico City"), so instead of matching fixed phrases we check whether a
  // foreign country name appears NEAR a location cue word.
  const LOC_CUES = ["location", "based", "headquarters", "hq", "office", "reside",
    "authorized to work", "eligible to work", "must be", "candidates in", "role is in"];
  const userTerms = COUNTRY_TERMS[country] || [];
  function bodyTiesToForeignCountry() {
    for (const c of FOREIGN_COUNTRIES) {
      if (userTerms.some((t) => t === c) || country === c) continue; // user's own target
      if (!hasPhrase(desc, c)) continue;
      // country is mentioned — is it near a location cue? scan a window.
      const idx = desc.indexOf(c);
      if (idx === -1) continue;
      const window = desc.slice(Math.max(0, idx - 60), idx + 60);
      if (LOC_CUES.some((cue) => window.includes(cue))) return c;
    }
    return null;
  }
  const tiedCountry = bodyTiesToForeignCountry();
  if (tiedCountry) {
    return E("excluded", `Body ties the role to ${tiedCountry}`, false);
  }

  // 2. Explicit target in LOCATION field → certain.
  const locField = ` ${loc} ${region} `;
  if (country === "africa") {
    if (hasAny(locField, AFRICA_TERMS)) return softenForTimezone(E("certain", "Location mentions Africa"));
  } else if (REGION_POSITIVE[country]) {
    if (hasAny(locField, REGION_POSITIVE[country])) return softenForTimezone(E("certain", `Location mentions ${country}`));
  } else {
    for (const label of COUNTRY_TERMS[country] || []) {
      if (hasPhrase(locField, label)) return softenForTimezone(E("certain", `Location mentions ${label}`));
    }
  }

  // 3. Worldwide/anywhere in LOCATION → certain.
  if (hasAny(loc, WORLDWIDE_LOCATION)) return softenForTimezone(E("certain", "Open worldwide / anywhere"));

  // 4. EMEA in location → likely for Africa and MENA targets.
  if ((isAfrican || country === "mena") && hasAny(loc, EMEA_POSITIVE))
    return softenForTimezone(E("likely", "EMEA region"));

  // 5. POSITIVE-EVIDENCE GATE — universal for all country targets.
  //    Nothing matched above → no positive signal this role is open to target.
  //    Require evidence; don't default to "possible".
  const l = loc.trim();
  const bare = !l || ["remote","remote,","anywhere","n/a","-","not specified",
                      "remote worldwide","fully remote","global"].includes(l);
  if (!bare) return E("excluded", `Location tied to ${job.location}`, false);

  // Bare "Remote": read description for positive signal or country tie.
  // A strong worldwide phrase in the body ("work from anywhere", "open to
  // candidates worldwide") is as definitive as a worldwide location field, so
  // it's "certain" — but only if the body doesn't ALSO tie it to a country.
  if (hasAny(desc, WORLDWIDE_DESC_STRONG)) {
    if (hasAny(desc, FOREIGN_COUNTRIES)) return E("likely", "Remote, worldwide language but a country is mentioned");
    return softenForTimezone(E("certain", "JD: open to anyone, anywhere"));
  }
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
    else eligibility = genericEligibility(job, title, desc);
  } else {
    // NO country, NO remote in the query (e.g. a guest typing "copywriting
    // jobs for me"). This path previously did ZERO checking — a Stripe·US
    // on-site job sailed through as Conditional. Never skip eligibility:
    // the default audience is Africa-first.
    eligibility = genericEligibility(job, title, desc);
  }

  // STEP 1b: REMOTE ENFORCEMENT — "remote X open to Nigeria" must not surface
  // on-site local jobs just because the location mentions the country.
  // (Real trust failure: Lagos on-site intern ranked 90% on a remote search.)
  if (eligibility.eligible && intent.remoteOnly) {
    const remoteField = ` ${(job.location || "").toLowerCase()} ${title} ${desc.slice(0, 2000)} `;
    const hasRemoteSignal =
      job.remote === true ||
      hasAny(remoteField, ["remote", "work from home", "wfh", "work from anywhere", "fully distributed", "distributed team", "telecommute"]);
    if (!hasRemoteSignal) {
      if (hasPhrase(remoteField, "hybrid")) {
        eligibility = {
          eligible: true, confidence: "possible",
          reason: `Hybrid${job.location ? ` in ${job.location}` : ""} — confirm the remote arrangement before applying`,
        };
      } else {
        eligibility = {
          eligible: false, confidence: "excluded",
          reason: `On-site${job.location ? ` in ${job.location}` : ""} — you asked for remote`,
        };
      }
    }
  }

  // STEP 2: role match (0–55) — judged by the job's OWN TITLE at search time,
  // so a stale stored role_cluster can't inflate an off-target role
  // (e.g. "Cloud Support Engineer" stored as Customer Support).
  let roleScore = 0;
  // Normalize title for alias matching: strip parenthetical expansions like
  // "(BI)" or "(SRE)" that break substring matches against stored aliases.
  // "Business Intelligence (BI) Analyst" → "Business Intelligence Analyst"
  const titleNorm = title.replace(/\s*\([^)]{1,8}\)\s*/g, " ").replace(/\s+/g, " ");
  const titleAliasHit = intent.matchedAliases?.some((a) => hasPhrase(titleNorm, a));
  const descAliasHit = intent.matchedAliases?.some((a) => hasPhrase(desc, a));
  const titleCluster = detectCluster(job.title || "").cluster; // what the TITLE really is

  // Does the title contain the user's ACTUAL search phrase (not just a sibling
  // alias in the same cluster)? "data analyst" search -> "Data Analyst" title is
  // a bullseye; "Product Analyst" is same-cluster but NOT what they asked for.
  const queryPhrase = (intent.rawQuery || "")
    .toLowerCase()
    .replace(/\b(jobs?|roles?|positions?|open|to|me|remote|that|are|for|in|the|a|an)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const exactTitleHit = queryPhrase.length >= 4 && hasPhrase(title, queryPhrase);

  if (exactTitleHit) roleScore = 55;                                  // exact query phrase in title = bullseye
  else if (titleAliasHit) roleScore = 45;                             // a (possibly sibling) cluster alias in title
  else if (titleCluster && titleCluster === intent.cluster) roleScore = 42;  // title's own cluster matches
  else if (titleCluster && intent.cluster && titleCluster !== intent.cluster) roleScore = 6; // clearly different role
  else if (descAliasHit) roleScore = 22;                            // query alias in body
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

  // STEP 3: eligibility confidence component.
  // Sub-tiers within "certain":
  //   explicit country mention (e.g. "Location mentions nigeria") → 42
  //     The job specifically named the user's country — strongest signal.
  //   worldwide / open anywhere → 38
  //     Open to all, but no explicit country confirmation.
  //   likely   → 30  (regional signal e.g. EMEA)
  //   possible → 20  ("region unconfirmed" — eligibility not proven)
  //
  // This ensures a BI Analyst explicitly listing Nigeria ranks above a
  // generic "Data Analyst · Worldwide" for the same search, even if the
  // worldwide job has a marginally better role-title match.
  const explicitCountry = eligibility.confidence === "certain" &&
    /location mentions|open to.*nigeria|open to.*kenya|open to.*ghana|open to.*africa/i.test(eligibility.reason);
  const locScore = explicitCountry ? 48
    : { certain: 38, likely: 30, possible: 20 }[eligibility.confidence] ?? 20;

  // STEP 4: tiny tiebreaker signals — kept SMALL (max ~3 total) so they only
  // separate near-identical results and can never overcome a role-fit gap.
  let bonus = 0;
  const d = job.posted_at || job.created_at;
  if (d) {
    const days = (Date.now() - new Date(d)) / 86400000;
    if (days <= 3) bonus += 6;
    else if (days <= 7) bonus += 4;
    else if (days <= 21) bonus += 2;
    else if (days > 90) bonus -= 6;
    else if (days > 45) bonus -= 3;
  }
  if (job.salary_min || job.salary_max) bonus += 1;
  bonus = Math.max(-6, Math.min(bonus, 7));

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
    // Title gave us nothing. Before trusting the description, demand a STRONG,
    // CORROBORATED match — not just a high score, but 2+ independent signals.
    //
    // BUG THIS FIXES: a single incidental mention of a multi-word alias (e.g.
    // one boilerplate HR sentence — "the company operates a performance
    // management system for all staff" — in an otherwise-unrelated JD for a
    // "General Manager", "City Manager", or "Chief Executive Officer") scores
    // ~86 on its own, clearing any reasonable score floor. Generic/leadership
    // titles have no specific cluster BY DESIGN — a JD mentioning one HR/ops/
    // finance term in passing must not hijack them into that cluster. This is
    // systemic: any cluster with a distinctive alias is vulnerable to the same
    // "one throwaway sentence" false positive, on any search, for any title
    // that doesn't itself signal a function.
    //
    // Fix: require 2+ genuinely DISTINCT signals (not nested/overlapping text)
    // before trusting body-only classification. One incidental mention of a
    // role phrase — "the company operates a performance management system"
    // in an unrelated General Manager posting — is exactly ONE distinct signal
    // and correctly falls through to Other. A genuine role description
    // mentions its function via multiple, non-overlapping pieces of evidence
    // (the role phrase AND its tools/practices — e.g. "performance management"
    // AND "OKR cycles" AND "360 feedback" are three separate, real signals).
    const bodyDet = detectCluster(`${title} ${description}`);
    const BODY_CONFIDENCE_FLOOR = 60;
    const BODY_MIN_DISTINCT_SIGNALS = 2;
    if (bodyDet.cluster && bodyDet.score >= BODY_CONFIDENCE_FLOOR && bodyDet.distinctSignals >= BODY_MIN_DISTINCT_SIGNALS) {
      cluster = bodyDet.cluster;
    }
  }
  if (cluster) {
    const e = ROLE_TAXONOMY.find((x) => x.cluster === cluster);
    return { role_cluster: cluster, department: e ? e.department : "Other" };
  }
  return { role_cluster: "Other", department: "Other" };
}

// expose detector for tests / tooling
export { detectCluster };
