// Merge independent role searches without turning failures into empty results.
export async function loadBriefingFeed({queries, country, search}) {
  const uniqueQueries = [...new Set(queries.filter(Boolean))];
  let next = 0;
  const results = [], failed = [];
  await Promise.all(Array.from({length: Math.min(2, uniqueQueries.length)}, async () => {
    while (next < uniqueQueries.length) {
      const q = uniqueQueries[next++];
      try {
        const response = await search({q, country, limit: 5});
        results.push(...(response.data || []));
      } catch { failed.push(q); }
    }
  }));
  const time = job => Number.isFinite(Date.parse(job.posted_at)) ? Date.parse(job.posted_at) : -Infinity;
  results.sort((a,b) => time(b) - time(a) || (b.score || 0) - (a.score || 0) || String(a.id).localeCompare(String(b.id)));
  const ids = new Set(), urls = new Set(), content = new Set();
  const jobs = results.filter(job => {
    const key = job.company && job.title ? [job.company, job.title, job.location || ''].map(s => s.toLowerCase().trim()).join('::') : null;
    if ((job.id && ids.has(job.id)) || (job.apply_url && urls.has(job.apply_url)) || (key && content.has(key))) return false;
    if (job.id) ids.add(job.id);
    if (job.apply_url) urls.add(job.apply_url);
    if (key) content.add(key);
    return true;
  }).slice(0,5);
  return {jobs, failed, allFailed: uniqueQueries.length > 0 && failed.length === uniqueQueries.length};
}
