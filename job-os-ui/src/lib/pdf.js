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

/* ── Character safety ─────────────────────────────────────────────────────
 * jsPDF's built-in fonts are WinAnsi-encoded. Anything outside that set is
 * silently mangled — an arrow "→" came out as "!" in a real generated CV, and
 * non-breaking hyphens vanished mid-word ("Product-focused" -> "Product
 * focused"). The model is asked for plain ASCII, but a prompt is a request,
 * not a constraint, so every string is transliterated on the way in.
 *
 * Order matters: named replacements first, then a final sweep that strips any
 * remaining non-ASCII rather than letting jsPDF guess.
 */
// Written as escapes, not literal glyphs: several of these are invisible, and a
// source file containing real zero-width characters is unreviewable (and trips
// no-irregular-whitespace / no-misleading-character-class).
const CHAR_MAP = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],            // curly single quotes, prime
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],            // curly double quotes
  [/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-'],      // hyphens, en/em dashes
  [/[\u2192\u27A1\u2794]/g, '->'],                          // arrows - the "!" bug
  [/\u2190/g, '<-'],
  [/\u2026/g, '...'],                                        // ellipsis
  [/[\u2022\u25CF\u25AA\u00B7]/g, '-'],                    // stray bullet glyphs
  [/[\u00A0\u2007\u2008\u2009\u200A\u2002\u2003]/g, ' '], // nbsp / thin / en / em spaces
  // Zero-width chars, each on its own so the joiner (200D) is never read as
  // part of a combined sequence with its neighbours.
  [/\u200B/g, ''], [/\u200C/g, ''], [/\u200D/g, ''], [/\uFEFF/g, ''],
  [/\u2122/g, '(TM)'], [/\u00AE/g, '(R)'], [/\u00A9/g, '(C)'],
  [/\u2264/g, '<='], [/\u2265/g, '>='], [/\u2260/g, '!='],
  [/\u00D7/g, 'x'],
];

function ascii(input) {
  let s = String(input ?? "");
  for (const [re, to] of CHAR_MAP) s = s.replace(re, to);
  // Anything still outside printable ASCII would be corrupted by the font, so
  // drop it. Accented Latin letters are decomposed first so "José" keeps its
  // letters ("Jose") instead of losing the character entirely.
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return s.replace(/[^\x20-\x7E\n]/g, "");
}

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

/** Deep-transliterate every string in the CV once, rather than at each draw call. */
function sanitizeCv(cv) {
  return {
    name: ascii(cv?.name),
    contact: ascii(cv?.contact),
    summary: ascii(cv?.summary),
    sections: (cv?.sections || []).map((s) => ({
      heading: ascii(s?.heading),
      entries: (s?.entries || []).map((e) => ({
        title: ascii(e?.title),
        org: ascii(e?.org),
        dates: ascii(e?.dates),
        bullets: (e?.bullets || []).map(ascii).filter(Boolean),
      })),
    })),
  };
}

export async function downloadCvPdf(rawCv, filename = "CV.pdf") {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const cv = sanitizeCv(rawCv);
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
