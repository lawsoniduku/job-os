import axios from "axios";

export async function fetchRemoteOK() {
  try {
    console.log("📡 RemoteOK fetching...");

    const res = await axios.get("https://remoteok.com/api", {
      timeout: 15000
    });

    const jobs = res.data
      .filter(j => j && j.position)
      .map(j => ({
        source: "remoteok",
        company: j.company || "Unknown",
        title: j.position,
        description: j.description || "",
        location: j.location || "",
        apply_url: j.url,
        raw: j
      }));

    console.log(`✔ RemoteOK: ${jobs.length}`);

    return jobs;
  } catch (e) {
    console.log("❌ RemoteOK failed");
    return [];
  }
}