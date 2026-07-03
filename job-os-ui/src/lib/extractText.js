/**
 * lib/extractText.js — CV file -> plain text (PDF / DOCX / TXT).
 * Ported unchanged from the previous UI: PDF.js + mammoth via CDN.
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return await file.text();
  }

  if (name.endsWith(".pdf")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          if (!window.pdfjsLib) {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          }
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await window.pdfjsLib.getDocument({ data: typedArray }).promise;
          let text = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map((item) => item.str).join(" ") + "\n";
          }
          resolve(text.trim());
        } catch (err) {
          reject(new Error("Could not read PDF: " + err.message));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          if (!window.mammoth) {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
          }
          const result = await window.mammoth.extractRawText({ arrayBuffer: e.target.result });
          resolve(result.value.trim());
        } catch (err) {
          reject(new Error("Could not read DOCX: " + err.message));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error(`Unsupported file type: ${name.split(".").pop().toUpperCase()}. Please use PDF, DOCX, or TXT.`);
}
