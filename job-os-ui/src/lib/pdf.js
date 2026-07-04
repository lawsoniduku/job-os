/**
 * lib/pdf.js — render the STRUCTURED tailored CV into a clean A4 PDF.
 *
 * The structure comes from /ai/cv-rewrite (result.cv):
 *   { name, contact, summary, sections: [{ heading, entries: [{ title, org, dates, bullets[] }] }] }
 *
 * Layout mirrors a professional single-column CV:
 *   Name (17pt bold) / contact line (9.5pt gray)
 *   ─ SECTION HEADING with rule
 *   Role — Company                                    dates (right-aligned)
 *   • bullet
 * ATS-friendly by construction: single column, real text, standard fonts.
 */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

const M = 48;                 // margin (pt)
const PAGE_W = 595;           // A4
const PAGE_H = 842;
const W = PAGE_W - M * 2;
const BOTTOM = PAGE_H - M;

export async function downloadCvPdf(cv, filename = "CV.pdf") {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = M;

  const breakIf = (needed) => { if (y + needed > BOTTOM) { doc.addPage(); y = M; } };

  /* ── Header ─────────────────────────────────────────────── */
  if (cv.name) {
    doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(17, 22, 31);
    const lines = doc.splitTextToSize(cv.name, W);
    doc.text(lines, M, y + 15);
    y += lines.length * 20 + 2;
  }
  if (cv.contact) {
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(108, 114, 126);
    const lines = doc.splitTextToSize(cv.contact, W);
    doc.text(lines, M, y + 10);
    y += lines.length * 12 + 4;
  }

  /* ── Summary ────────────────────────────────────────────── */
  if (cv.summary) {
    sectionHeading(doc, "PROFESSIONAL SUMMARY", () => breakIf(30));
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(45, 51, 62);
    const lines = doc.splitTextToSize(cv.summary, W);
    breakIf(lines.length * 13.5);
    doc.text(lines, M, y + 10);
    y += lines.length * 13.5 + 2;
  }

  /* ── Sections ───────────────────────────────────────────── */
  for (const section of cv.sections || []) {
    sectionHeading(doc, section.heading, () => breakIf(30));

    for (const e of section.entries || []) {
      const headLeft = [e.title, e.org].filter(Boolean).join("  —  ");

      if (headLeft || e.dates) {
        breakIf(16);
        if (headLeft) {
          doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(25, 30, 40);
          // Leave room for right-aligned dates
          const leftW = e.dates ? W - 110 : W;
          const lines = doc.splitTextToSize(headLeft, leftW);
          doc.text(lines, M, y + 11);
          if (e.dates) {
            doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(108, 114, 126);
            doc.text(e.dates, M + W, y + 11, { align: "right" });
          }
          y += lines.length * 14 + 1;
        } else if (e.dates) {
          doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(108, 114, 126);
          doc.text(e.dates, M, y + 11);
          y += 14;
        }
      }

      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(45, 51, 62);
      for (const b of e.bullets || []) {
        const lines = doc.splitTextToSize(b, W - 14);
        breakIf(lines.length * 13.5 + 1);
        doc.text("•", M + 2, y + 10);
        doc.text(lines, M + 14, y + 10);
        y += lines.length * 13.5 + 1.5;
      }
      y += 5; // gap between entries
    }
  }

  doc.save(filename);

  /* helper — heading with rule; uses outer y via closure */
  function sectionHeading(d, label, ensure) {
    if (!label) return;
    y += 8;
    ensure();
    d.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(17, 22, 31);
    d.text(String(label).toUpperCase(), M, y + 11);
    y += 15;
    d.setDrawColor(206, 210, 218).setLineWidth(0.6);
    d.line(M, y, M + W, y);
    y += 7;
  }
}

/** Safe filename: "CV - Deel - Senior Data Analyst.pdf" */
export function cvFilename(company, title) {
  const clean = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "").trim();
  const parts = ["CV", clean(company), clean(title)].filter(Boolean);
  return parts.join(" - ").slice(0, 120) + ".pdf";
}
