import { AlignmentType, Document, Footer, Packer, PageNumber, Paragraph, TextRun } from "docx";
import { buildModel } from "./document-model";
import type { ToolData } from "./tools-config";
export { buildModel } from "./document-model";
const FONT = "Times New Roman";
function paragraph(text: string, heading = false, left = false) {
  return new Paragraph({
    alignment: heading || left ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    spacing: { after: heading ? 220 : 180, before: heading ? 240 : 0, line: 300 },
    keepNext: heading, widowControl: true,
    children: text.split(/(\[completar: [^\]]+\]|\n)/g).filter(Boolean).map(part => new TextRun({
      text: part === "\n" ? "" : part, break: part === "\n" ? 1 : undefined,
      font: FONT, size: 24, bold: heading,
      ...(part.startsWith("[completar:") ? { highlight: "yellow" as const, color: "7A2E00" } : {}),
    })),
  });
}
export async function buildDocument(kind: string, data: ToolData): Promise<Buffer> {
  const model = buildModel(kind, data);
  const doc = new Document({
    creator: "RAIZIA", title: model.title, description: "Borrador para revisión",
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1701, right: 1418 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Página ", font: FONT, size: 20 }), new TextRun({ children: [PageNumber.CURRENT], size: 20 }), new TextRun({ text: " de ", size: 20 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 20 })] })] }) },
      children: [paragraph(model.date, false, true), ...model.addressee.map(s => paragraph(s, false, true)), ...model.reference.map(s => paragraph(s, true)), paragraph(model.intro), ...model.sections.flatMap(s => [paragraph(s.title, true), ...s.paragraphs.map(p => paragraph(p))]), ...model.signature.map(s => paragraph(s, false, true))],
    }],
  });
  return Packer.toBuffer(doc);
}
