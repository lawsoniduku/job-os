/**
 * lib/profile.js — what a complete profile is, and what each part buys.
 *
 * One source of truth for profile completeness, used by the You tab's
 * strength meter, the Briefing prompt, and the employer preview. Keeping the
 * definition here (rather than inline in a component) is what stops the
 * meter and the thing it measures from drifting apart.
 *
 * TWO RULES THIS FILE ENFORCES:
 *
 *  1. Every field states what the USER gets, not what we get. "Employers
 *     filter on this" is a reason for us; "roles you can't apply to stop
 *     reaching you" is a reason for them. People complete profiles for the
 *     second kind of reason.
 *
 *  2. CONSENT IS NOT COMPLETENESS. visible_to_employers is deliberately
 *     absent from the score. If opting in were worth points, the meter would
 *     nag people toward a privacy decision to clear a progress bar — which
 *     is precisely the pressure 012's consent design exists to prevent. The
 *     bar reaches 100% whether or not they ever share anything.
 */

/* ── Field definitions ────────────────────────────────────────────────────
 * `done` reads the saved profile (plus cvInfo, which lives in saved_cvs).
 * Weights sum to 100 and are ordered by how much the product can actually do
 * with the field — the CV is worth more than a salary floor because almost
 * everything downstream reads it.
 */
export const PROFILE_FIELDS = [
  {
    key: "country",
    label: "Where you're based",
    unlocks: "Every search gets eligibility-checked — region-locked roles stop reaching you.",
    weight: 15,
    section: "details",
    done: (p) => !!p?.country,
  },
  {
    key: "cv",
    label: "Your CV",
    unlocks: "Tailor & apply starts from it, and we read your skills off it so you don't type them.",
    weight: 20,
    section: "cv",
    done: (_p, cv) => !!cv,
  },
  {
    key: "target_roles",
    label: "Preferred roles",
    unlocks: "Your daily Briefing is built from these.",
    weight: 12,
    section: "details",
    done: (p) => (p?.target_roles?.length || 0) > 0,
  },
  {
    key: "skills",
    label: "Confirmed skills",
    unlocks: "What you actually stand behind, not just what the CV happened to say.",
    weight: 15,
    section: "skills",
    done: (p) => (p?.skills?.length || 0) > 0,
  },
  {
    key: "experience",
    label: "Title and years",
    unlocks: "Stops junior roles crowding out senior matches, and the reverse.",
    weight: 10,
    section: "skills",
    done: (p) => !!p?.headline && Number.isFinite(p?.years_experience),
  },
  {
    key: "work_authorization",
    label: "Right to work",
    unlocks: "Sharper than country alone — a second passport or existing visa opens roles your location would have hidden.",
    weight: 12,
    section: "eligibility",
    done: (p) => !!p?.work_authorization?.residence,
  },
  {
    key: "availability",
    label: "When you can start",
    unlocks: "The first thing a hiring manager checks before replying.",
    weight: 8,
    section: "eligibility",
    done: (p) => !!p?.availability,
  },
  {
    key: "target_salary_min",
    label: "Salary floor",
    unlocks: "Roles paying under it stop taking up space in your feed.",
    weight: 8,
    section: "eligibility",
    done: (p) => Number.isFinite(p?.target_salary_min) && p.target_salary_min > 0,
  },
];

/* ── The employer-ready bar ───────────────────────────────────────────────
 * The subset an employer query genuinely cannot work without. Someone can be
 * employer-ready at 80% (skipping salary and preferred roles) — the bar and
 * the score answer different questions, and conflating them would mean
 * telling a perfectly shortlist-able candidate they aren't ready.
 */
const EMPLOYER_READY_KEYS = ["country", "cv", "skills", "experience", "work_authorization", "availability"];

/**
 * strengthOf(profile, cvInfo) -> {
 *   pct, done[], missing[], next, employerReady, complete
 * }
 * `next` is the single highest-value missing field — the meter only ever
 * asks for one thing at a time, because a list of eight gaps reads as a form
 * and gets abandoned like one.
 */
export function strengthOf(profile, cvInfo) {
  const done = [];
  const missing = [];
  for (const f of PROFILE_FIELDS) {
    (f.done(profile, cvInfo) ? done : missing).push(f);
  }
  const pct = Math.round(done.reduce((n, f) => n + f.weight, 0));
  const employerReady = EMPLOYER_READY_KEYS.every(
    (k) => !missing.some((m) => m.key === k)
  );
  // Highest weight first; ties break toward the earlier definition, which is
  // roughly "cheapest to answer".
  const next = missing.slice().sort((a, b) => b.weight - a.weight)[0] || null;
  return { pct, done, missing, next, employerReady, complete: missing.length === 0 };
}

/* ── Copy for the meter ───────────────────────────────────────────────────
 * Deliberately not congratulatory below 100 — "you're doing great!" over a
 * 40% bar is the tone that makes people stop trusting the number.
 */
export function strengthLabel(pct) {
  if (pct >= 100) return "Complete";
  if (pct >= 80) return "Nearly there";
  if (pct >= 50) return "Half done";
  if (pct >= 25) return "Getting started";
  return "Just started";
}

/* ── Availability ─────────────────────────────────────────────────────────
 * Values mirror the check constraint in migration 013. Changing one without
 * the other fails the write, so they are commented on both sides.
 */
export const AVAILABILITY_OPTIONS = [
  { value: "immediately",   label: "Immediately" },
  { value: "2_weeks",       label: "Within 2 weeks" },
  { value: "1_month",       label: "About a month" },
  { value: "2_months",      label: "About 2 months" },
  { value: "3_months_plus", label: "3 months or more" },
];

export function availabilityLabel(v) {
  return AVAILABILITY_OPTIONS.find((o) => o.value === v)?.label || null;
}

/* ── Employer preview ─────────────────────────────────────────────────────
 * The exact shape an employer-facing shortlist row would carry, built from
 * the same profile the candidate is looking at. Two jobs: it is the honest
 * answer to "what do they see about me", and it is the best completion
 * driver we have — people fix what they can see is thin.
 *
 * Note what is NOT in here: email, full name, and anything the CV parse was
 * told not to extract. An employer seeing a shortlist row does not get
 * contact details; that is a later, separate, explicitly-consented step.
 */
export function employerPreview(profile, appsByCluster = []) {
  const skills = profile?.skills?.length ? profile.skills : (profile?.cv_skills || []);
  return {
    // Identity is reduced to a first name and a location, on purpose.
    displayName: (profile?.full_name || "").trim().split(/\s+/)[0] || "Candidate",
    country: profile?.country || null,
    headline: profile?.headline || (profile?.cv_titles?.[0] ?? null),
    years: Number.isFinite(profile?.years_experience) ? profile.years_experience : profile?.cv_years ?? null,
    skills: skills.slice(0, 12),
    // Whether each skill is confirmed by the candidate or merely parsed off
    // the document — the distinction 012 insists the employer UI must keep.
    skillsConfirmed: (profile?.skills?.length || 0) > 0,
    availability: availabilityLabel(profile?.availability),
    workAuth: profile?.work_authorization || null,
    // Behavioural evidence — the only part an employer can weigh that the
    // candidate did not write themselves.
    activity: appsByCluster,
  };
}
