const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "../../apps/api/controllers/dashboardController.js");
const source = fs.readFileSync(file, "utf8");

const checks = [
  "const sourcePlantScope",
  "AND plant=$2 AND source_row_id=$1::text",
  "ex2.plant = src.plant",
  "(source_system, plant, source_row_id) DO UPDATE",
  "AND plant = $2 AND source_row_id = $1",
  "ex.plant = $1",
];
for (const check of checks) {
  if (!source.includes(check)) throw new Error(`Missing multi-plant guard: ${check}`);
}
console.log(`OK: ${checks.length} dashboard multi-plant contract checks`);
