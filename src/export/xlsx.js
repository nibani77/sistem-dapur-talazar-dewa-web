// Pembuat file Excel (.xlsx) minimal tanpa library.
// sheets: [{ name, widths: [lebar kolom...], freezeRows?: n, rows: [[cell, ...], ...] }]
// cell: nilai biasa (teks/angka) atau { v, s } dengan s = nama gaya (lihat STYLE di bawah).
const { createZip, xmlEscape } = require("./zip");

const STYLE = {
  default: 0,
  title: 1,
  header: 2,
  text: 3,
  money: 4,
  number: 5,
  bold: 6,
  moneyTotal: 7,
  muted: 8,
  boldPlain: 9,
  labelTotal: 10
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;Rp&quot;#,##0"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3F4B3A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1E4C6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function colName(i) {
  let n = i + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function safeSheetName(name, used) {
  let base = String(name).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let out = base, n = 2;
  while (used.has(out.toLowerCase())) { out = base.slice(0, 28) + " " + n++; }
  used.add(out.toLowerCase());
  return out;
}

// Perkiraan tinggi baris (Excel tidak selalu menghitung otomatis untuk file buatan program).
function estimateLines(text, width) {
  const per = Math.max(4, Math.floor(width * 1.05));
  return String(text).split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / per)), 0);
}

function sheetXml(sheet) {
  const widths = sheet.widths || [];
  const rowsXml = sheet.rows.map((row, r) => {
    let maxLines = 1;
    const cells = row.map((cell, c) => {
      if (cell === null || cell === undefined || cell === "") {
        // sel kosong tetap diberi gaya bila ada (supaya garis tabel utuh)
        const s = cell && cell.s ? STYLE[cell.s] : null;
        return s ? `<c r="${colName(c)}${r + 1}" s="${s}"/>` : "";
      }
      const v = typeof cell === "object" ? cell.v : cell;
      const s = typeof cell === "object" && cell.s ? STYLE[cell.s] || 0 : 0;
      const ref = `${colName(c)}${r + 1}`;
      if (typeof v === "number" && Number.isFinite(v)) {
        return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
      }
      if (v === null || v === undefined || v === "") return s ? `<c r="${ref}" s="${s}"/>` : "";
      const text = String(v);
      if ([STYLE.text, STYLE.bold, STYLE.header, STYLE.labelTotal].includes(s)) {
        maxLines = Math.max(maxLines, estimateLines(text, widths[c] || 12));
      }
      return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }).join("");
    const ht = maxLines > 1 ? ` ht="${Math.min(409, maxLines * 15)}" customHeight="1"` : "";
    return `<row r="${r + 1}"${ht}>${cells}</row>`;
  }).join("");

  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const freeze = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const landscape = `<pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>${landscape}</worksheet>`;
}

function buildXlsx(sheets) {
  const used = new Set();
  const names = sheets.map((s) => safeSheetName(s.name, used));

  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    },
    { name: "xl/styles.xml", data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))
  ];
  return createZip(files);
}

module.exports = { buildXlsx };
