/**
 * lib/applyIntent.test.mjs — pipeline status transitions
 * ======================================================
 * Run: node job-os-ui/src/lib/applyIntent.test.mjs
 *
 * These are the rules that decide WHICH COLUMN a card lands in. They are
 * asserted here rather than only in the UI because two bugs in this logic
 * shipped looking fine:
 *
 *   - "Save for later" upserted with ignoreDuplicates, so once apply-intent
 *     capture had already created the row, saving changed nothing and the card
 *     stayed under Applied while the toast said it was saved.
 *   - "Not yet" deliberately left the status alone, which meant applied_intent
 *     — and applied_intent renders in the Applied column, so the card sat under
 *     Applied while the toast said "Kept in Saved".
 *
 * Both were invisible to any test that checked the write succeeded, because
 * both writes DID succeed. What was wrong was where the card ended up, so that
 * is what these assert.
 */

// Mirrors Pipeline.jsx COLS. If that changes, this must change with it.
const COLUMN_OF = {
  saved: "Saved", shortlist: "Saved", interested: "Saved", cv_tailored: "Saved",
  applied: "Applied", applied_intent: "Applied",
  assessment: "In process", interview: "In process", in_process: "In process",
  offer: "Offer",
  rejected: "Closed", archived: "Closed", closed: "Closed",
};

const EARLY_STAGES = ["saved", "shortlist", "interested", "cv_tailored", "applied_intent"];

// Mirrors resolveApplyIntent's status map.
function moveFor(outcome, reason = null) {
  if (outcome === "applied")   return "applied";
  if (outcome === "not_yet")   return "saved";
  if (outcome === "abandoned") return reason === "broken" ? "saved" : "closed";
  return null;
}

// Mirrors saveForLater: insert-if-missing, then move when still early.
function saveForLater(currentStatus) {
  if (currentStatus === null) return "saved";                    // fresh insert
  return EARLY_STAGES.includes(currentStatus) ? "saved" : currentStatus;
}

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${name}`);
  if (!ok) console.log(`       got "${got}", wanted "${want}"`);
};

console.log("\n📌 SAVE FOR LATER — the reported bug");
t("after clicking the posting (applied_intent) → Saved",
  COLUMN_OF[saveForLater("applied_intent")], "Saved");
t("on a job never seen before → Saved",
  COLUMN_OF[saveForLater(null)], "Saved");
t("on an already-saved job → stays Saved",
  COLUMN_OF[saveForLater("saved")], "Saved");

console.log("\n🛡️  SAVE FOR LATER — must never drag a real application backwards");
t("a job at interview stays In process", COLUMN_OF[saveForLater("interview")], "In process");
t("a job at applied stays Applied",      COLUMN_OF[saveForLater("applied")],   "Applied");
t("a job at offer stays Offer",          COLUMN_OF[saveForLater("offer")],     "Offer");

console.log("\n💬 NUDGE ANSWERS — the card must land where the toast says");
t("'Yes, applied' → Applied",            COLUMN_OF[moveFor("applied")],            "Applied");
t("'Not yet — keep it' → Saved",         COLUMN_OF[moveFor("not_yet")],            "Saved");
t("'Not applying' + expired → Closed",   COLUMN_OF[moveFor("abandoned","expired")], "Closed");
t("'Not applying' + location → Closed",  COLUMN_OF[moveFor("abandoned","location")],"Closed");
t("broken form → Saved, not Closed",     COLUMN_OF[moveFor("abandoned","broken")],  "Saved");

console.log("\n🔁 NO ANSWER LEAVES A CARD UNDER 'Applied' BY ACCIDENT");
for (const outcome of ["applied", "not_yet"]) {
  const landed = COLUMN_OF[moveFor(outcome)];
  t(`'${outcome}' resolves to a real column (not applied_intent)`,
    moveFor(outcome) === "applied_intent" ? "applied_intent" : landed, landed);
}
t("applied_intent is the ONLY status that renders as unconfirmed Applied",
  Object.entries(COLUMN_OF).filter(([s, c]) => c === "Applied" && s !== "applied").map(([s]) => s).join(","),
  "applied_intent");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
