const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

// biar bisa ambil data antar domain (kalau nanti dipisah)
app.use(cors());
app.use(express.json());


// GET /api/devices -> list terkini
app.get("/api/devices", async (_req, res) => {
  try {
    const q = `
      select
        device,
        ip,
        sort_order,
        connection,
        rate_ms,
        success_pct
      from tablet_status
      order by sort_order asc, device asc`;
    const { rows } = await pool.query(q);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

app.use(express.static(path.join(__dirname, "../UI"), {
  extensions: ["html"]   // <--- ini bikin .html bisa disembunyiin
}));

const port = process.env.PORT || 3002;
app.listen(port, () => console.log("API running on :" + port));
