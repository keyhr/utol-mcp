import * as mupdf from "mupdf";

const MAX_PAGES = 50;
const IMAGE_DPI = 150;

export function extractText(buffer: Buffer): string {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = Math.min(doc.countPages(), MAX_PAGES);
  const parts: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    parts.push(page.toStructuredText().asText());
  }
  return parts.join("\n\n");
}

export function renderPages(buffer: Buffer): { data: string; mimeType: string }[] {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = Math.min(doc.countPages(), MAX_PAGES);
  const scale = IMAGE_DPI / 72;
  const images: { data: string; mimeType: string }[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pixmap.asPNG();
    images.push({ data: Buffer.from(png).toString("base64"), mimeType: "image/png" });
  }
  return images;
}
