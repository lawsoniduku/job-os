import axios from "axios";

/**
 * Get embedding from Ollama (qwen2 does NOT natively embed well,
 * so we use a lightweight trick: prompt-based vector fallback)
 */
export async function getEmbedding(text) {
  try {
    const res = await axios.post("http://localhost:11434/api/embeddings", {
      model: "qwen2:7b",
      prompt: text
    });

    return res.data.embedding;
  } catch (err) {
    console.log("❌ embedding failed:", err.message);
    return null;
  }
}