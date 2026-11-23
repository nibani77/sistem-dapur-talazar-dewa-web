const express = require("express");
const { requireAuth } = require("../middleware/auth");
const config = require("../config");

const router = express.Router();

// Data perusahaan untuk kop nota dan laporan cetak.
router.get("/", requireAuth, (req, res) => {
  res.json({ company: config.company() });
});

module.exports = router;
