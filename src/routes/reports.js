const express = require("express");
const { requireRole } = require("../middleware/auth");
const { fetchOrdersBetween } = require("../orderStore");
const { resolveRange, buildReport } = require("../reportBuilder");
const { buildReportXlsx, buildReportDocx, reportFileName } = require("../export/reportFiles");
const config = require("../config");

const router = express.Router();

async function loadReport(query) {
  const offset = config.offsetHours();
  const range = resolveRange({ from: query.from, to: query.to, group: query.group }, offset);
  if (range.error) return { error: range.error };
  const orders = await fetchOrdersBetween(range.fromMs, range.toMs);
  return { report: buildReport(orders, range, offset) };
}

// GET /api/reports?from=2026-10-01&to=2026-10-31&group=day|week|month
router.get("/", requireRole("admin"), async (req, res, next) => {
  try {
    const { report, error } = await loadReport(req.query);
    if (error) return res.status(400).json({ error });
    res.json({ report, company: config.company() });
  } catch (e) { next(e); }
});

// GET /api/reports/export?format=xlsx|docx&from=...&to=...&group=...
router.get("/export", requireRole("admin"), async (req, res, next) => {
  try {
    const format = String(req.query.format || "xlsx").toLowerCase();
    if (format !== "xlsx" && format !== "docx") {
      return res.status(400).json({ error: "Format harus xlsx (Excel) atau docx (Word)." });
    }
    const { report, error } = await loadReport(req.query);
    if (error) return res.status(400).json({ error });

    const company = config.company();
    const buffer = format === "xlsx" ? buildReportXlsx(report, company) : buildReportDocx(report, company);
    const type = format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    res.set("Content-Type", type);
    res.set("Content-Disposition", `attachment; filename="${reportFileName(report, format)}"`);
    res.set("Cache-Control", "no-store");
    res.send(buffer);
  } catch (e) { next(e); }
});

module.exports = router;
