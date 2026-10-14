// Unknown/missing verdicts must never receive the green Eligible badge.
export function verdictOf(job) {
  const e = job?.eligibility;
  if (e?.eligible === false || e?.confidence === "excluded")
    return { key: "conditional", label: "Not eligible" };
  if (e?.eligible === true && e.confidence === "certain")
    return { key: "eligible", label: "Eligible" };
  if (e?.eligible === true && e.confidence === "likely")
    return { key: "conditional", label: "Likely eligible" };
  return { key: "conditional", label: "Unconfirmed" };
}
