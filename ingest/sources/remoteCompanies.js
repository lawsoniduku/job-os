import axios from "axios";

// -----------------------------
// Remote-first companies layer
// -----------------------------
const companies = [
  {
    name: "Deel",
    url: "https://boards-api.greenhouse.io/v1/boards/deel/jobs"
  },
  {
    name: "Canonical",
    url: "https://boards-api.greenhouse.io/v1/boards/canonical/jobs"
  }
];

// -----------------------------
// IMPORTANT: named export
// -----------------------------
export async function fetchRemoteCompanies() {
  let all = [];

  for (const company of companies) {
    try {
      const res = await axios.get(company.url, { timeout: 10000 });

      const jobs = (res.data.jobs || []).map(job => ({
        source: "remote_company",
        company: company.name,
        title: job.title,
        description: job.content || "",
        location: job.location?.name || "",
        apply_url: job.absolute_url,
        raw: job
      }));

      console.log(`✔ Remote company: ${company.name} (${jobs.length})`);

      all = all.concat(jobs);
    } catch (e) {
      console.log(`⚠ Remote company skipped: ${company.name}`);
    }
  }

  return all;
}