/**
 * api/auth.js — identity for endpoints that touch someone's data.
 * ===============================================================
 *
 * WHY THIS FILE HAS TO EXIST BEFORE THE EMPLOYER SIDE DOES.
 *
 * Every endpoint written before this one was anonymous and stateless: you
 * hand /ai/cv-match a CV and a job id, it hands back an analysis, and it
 * never learns or reveals who you are. Nothing needed authentication
 * because nothing read a row belonging to a particular person.
 *
 * The employer side breaks that in one step. "Show me candidates matching
 * this role" and "show me who applied" both return other people's personal
 * data, and both must answer the question "who is asking, and what are they
 * allowed to see" before they return a single row.
 *
 * AND THE SAFETY NET IS NOT THERE. The comment at the top of /ai/cv-extract
 * reasons from "the server holds the ANON key … a write here would be
 * blocked by RLS". That was true of .env.example. It is NOT true of the
 * deployed .env, whose SUPABASE_KEY decodes to role=service_role. The server
 * bypasses row-level security entirely.
 *
 * So the rule for anything written from here on:
 *
 *   1. Identity comes from a VERIFIED JWT — never from the request body.
 *      A `user_id` in a body is a claim by the caller about themselves,
 *      and with service_role behind it, an unchecked claim is total access.
 *   2. Every query filters by that identity EXPLICITLY. There is no RLS
 *      backstop to catch a missing `.eq()`. The filter in the query is the
 *      whole of the access control.
 */

/**
 * Verifies the bearer token and attaches req.user.
 *
 * Takes the service_role client because supabase.auth.getUser(token) checks
 * the token's signature against the project, which is exactly the operation
 * we need and the one thing here that does not depend on which key we hold.
 */
export function makeRequireAuth(supabase) {
  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ error: "Sign in to continue." });
    }

    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) {
        // Expired is by far the most common case and deserves its own
        // message: the frontend can refresh and retry rather than dumping
        // the user back to a sign-in screen they just came from.
        return res.status(401).json({ error: "Your session expired — sign in again.", code: "session_expired" });
      }
      req.user = data.user;
      next();
    } catch {
      // A network failure talking to Supabase Auth is a 503, not a 401.
      // Telling someone their credentials are bad when the auth service is
      // simply unreachable sends them to reset a password that works fine.
      return res.status(503).json({ error: "Can't verify your session right now — try again in a moment." });
    }
  };
}

/**
 * Resolves the caller's employer org and attaches req.org / req.membership.
 * Must run after requireAuth.
 *
 * Membership is looked up server-side on every request rather than trusted
 * from a header or a cached claim, because org membership is exactly the
 * assertion an attacker would want to forge: it is the only thing standing
 * between an account and another company's applicant pile.
 */
export function makeRequireEmployer(supabase) {
  return async function requireEmployer(req, res, next) {
    const { data, error } = await supabase
      .from("employer_members")
      .select("org_id, role, employer_orgs(id, name, website, country, size, verified_at)")
      .eq("user_id", req.user.id);

    if (error) {
      return res.status(503).json({ error: "Couldn't load your employer account — try again." });
    }
    if (!data?.length) {
      // 403 not 404: the account is real and signed in, it just isn't an
      // employer yet. The frontend uses this to send them to org setup.
      return res.status(403).json({ error: "No employer account on this login.", code: "no_org" });
    }

    // Multi-org is supported by the schema but not yet by the UI. Until
    // there is an org switcher, an explicit header wins and the first
    // membership is the default — chosen over "reject if more than one" so
    // a second membership can never lock someone out of the first.
    const requested = req.headers["x-org-id"];
    const membership = (requested && data.find((m) => m.org_id === requested)) || data[0];

    if (requested && membership.org_id !== requested) {
      return res.status(403).json({ error: "You don't have access to that organisation." });
    }

    req.membership = membership;
    req.org = membership.employer_orgs;
    req.orgId = membership.org_id;
    next();
  };
}

/**
 * Attaches req.user when a token is present, but allows the request through
 * when it isn't. For endpoints that serve both — a public posting page that
 * shows an "Apply" button only to signed-in candidates.
 */
export function makeOptionalAuth(supabase) {
  return async function optionalAuth(req, _res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) return next();
    try {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) req.user = data.user;
    } catch {
      // Deliberately silent: this endpoint works signed-out, so a failure
      // to identify the caller is not a failure of the request.
    }
    next();
  };
}
