// Pembuat file Word (.docx) minimal tanpa library, halaman A4 lanskap.
// blocks:
//   { type: "title", text }              judul besar
//   { type: "sub", text }                teks kecil abu-abu
//   { type: "h2", text }                 judul bagian
//   { type: "p", text, bold? }           paragraf
//   { type: "table", widths: [twips], header: [teks], rows: [[sel...]] }
//        sel = teks atau { t: teks, align: "right", bold: true, fill: "F1E4C6" }
const { createZip, xmlEscape } = require("./zip");

const PAGE_W = 16838, PAGE_H = 11906, MARGIN = 900;
const USABLE = PAGE_W - MARGIN * 2; // 15038

function runs(text, { bold = false, size, color } = {}) {
  const lines = String(text === undefined || text === null ? "" : text).split("\n");
  const props = `${bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}${size ? `<w:sz w:val="${size}"/>` : ""}`;
  return lines.map((line, i) =>
    `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${i > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`
  ).join("");
}

function para(text, opts = {}) {
  const jc = opts.align ? `<w:jc w:val="${opts.align}"/>` : "";
  const spacing = `<w:spacing w:before="${opts.before || 0}" w:after="${opts.after === undefined ? 80 : opts.after}"/>`;
  return `<w:p><w:pPr>${opts.keepNext ? "<w:keepNext/>" : ""}${spacing}${jc}</w:pPr>${runs(text, opts)}</w:p>`;
}

function cellXml(cell, width, isHeader) {
  const c = typeof cell === "object" && cell !== null ? cell : { t: cell };
  const fill = isHeader ? "3F4B3A" : c.fill;
  const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
  const text = c.t === undefined || c.t === null ? "" : c.t;
  const p = para(text, {
    bold: isHeader || c.bold,
    color: isHeader ? "FFFFFF" : undefined,
    size: 18,
    align: isHeader ? "center" : c.align,
    after: 0
  });
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}</w:tcPr>${p}</w:tc>`;
}

function tableXml(b) {
  const sum = b.widths.reduce((a, x) => a + x, 0);
  const widths = b.widths.map((w) => Math.floor((w / sum) * USABLE));
  const border = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
  const head = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${b.header.map((h, i) => cellXml(h, widths[i], true)).join("")}</w:tr>`;
  const body = b.rows.map((r) =>
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cellXml(c, widths[i], false)).join("")}</w:tr>`
  ).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${USABLE}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${head}${body}</w:tbl>${para("", { after: 120 })}`;
}

function blockXml(b) {
  switch (b.type) {
    case "title": return para(b.text, { bold: true, size: 36, after: 40 });
    case "sub": return para(b.text, { size: 18, color: "666666", after: 160 });
    case "h2": return para(b.text, { bold: true, size: 26, before: 200, after: 100, keepNext: true });
    case "p": return para(b.text, { bold: b.bold, size: 20 });
    case "table": return tableXml(b);
    default: return "";
  }
}

function buildDocx(blocks) {
  const body = blocks.map(blockXml).join("");
  const sect = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}" w:orient="landscape"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${sect}</w:body></w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

  return createZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    { name: "word/styles.xml", data: styles },
    { name: "word/document.xml", data: document }
  ]);
}

module.exports = { buildDocx, USABLE };
