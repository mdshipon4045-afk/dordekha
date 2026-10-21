// Print the CREATE TABLE statements from a D1 export, so the live schema
// can be checked without spending the read budget.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "../backup2.sql";
let raw = readFileSync(file);
if (raw[0] === 0xff && raw[1] === 0xfe) raw = raw.subarray(2);
let sql = raw.toString("utf16le");
if (!sql.includes("INSERT INTO")) sql = readFileSync(file, "utf8");

for (const table of ["price_latest", "price_daily", "commodity", "district", "upazila"]) {
  const i = sql.indexOf(`CREATE TABLE ${table} (`);
  if (i < 0) {
    console.log(`--- ${table}: not in the export ---`);
    continue;
  }
  const end = sql.indexOf(");", i);
  console.log(`--- ${table} ---`);
  console.log(sql.slice(i, end + 2).replace(/\r\n/g, "\n"));
  console.log();
}
