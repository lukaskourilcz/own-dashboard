// Browser-only: pull plain text out of a PDF File with pdf.js. Kept apart from
// the pure, unit-tested parser (src/lib/invoice-parser.ts) so the heavy pdf.js
// bundle is dynamically imported (client, code-split) and never hits the server.

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;

function getPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      // Bundle the worker as an asset and point pdf.js at it.
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Extract the text of a PDF, one line per row (using pdf.js EOL hints). */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        } else {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line);
    }
  } finally {
    await loadingTask.destroy();
  }
  return lines.join("\n");
}
