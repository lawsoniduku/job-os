# Grounded applicant ranking

Both private CV uploads and direct applications use the same leased scoring queue.
The model maps CV evidence to the employer's required and preferred criteria;
each positive claim must retain an exact CV quote. The server computes the score:
required criteria weigh 3, preferred criteria 1; demonstrated work earns 1,
related responsibilities 0.75, a bare skill mention 0.25, missing evidence 0.
Missing evidence is a question for the recruiter, never proof of inability.

The score measures documented role fit, not a probability of success or a hiring
decision. No candidate moves stages automatically. Original CVs and human
scorecards remain the final review tools. Identity and protected characteristics
are excluded from the assessment instructions and rubric.

Summaries are assembled from validated criterion labels and CV quotes, rather
than allowing invented biographical prose. Metadata retains model, timestamp,
criteria snapshot and CV/role hashes. A role change invalidates old assessments.

Quota deferrals retain the CV and local evidence scan without assigning a semantic
score. Retry deadlines survive process restarts. Provider errors retry twice before
requiring an explicit retry; admission control respects Groq headers and reserves
capacity for interactive use. One cached assessment per unchanged CV/role avoids
repeat calls on every search, sort or review.

Validation: isolated database/API journey, grounded/fabricated quote cases,
semantic equivalents, required-vs-preferred ranking and identity invariance;
existing eligibility and search suites. No real applicant messages are sent.
