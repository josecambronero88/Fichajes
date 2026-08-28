const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const DEMO_EMPLOYEES = [
  ["e1", "Laura Gomez", "Sede 1"],
  ["e2", "Carlos Ruiz", "Sede 1"],
  ["e3", "Marta Diaz", "Sede 1"],
  ["e4", "David Lopez", "Sede 2"],
  ["e5", "Sara Moreno", "Sede 2"],
  ["e6", "Javier Ortega", "Sede 2"],
];

async function init() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await pool.query(schema);

  const { rows: sedeRows } = await pool.query("SELECT count(*)::int AS n FROM sedes");
  if (sedeRows[0].n === 0) {
    await pool.query("INSERT INTO sedes(name) VALUES ($1), ($2)", ["Sede 1", "Sede 2"]);
  }

  const { rows: empRows } = await pool.query("SELECT count(*)::int AS n FROM employees");
  if (empRows[0].n === 0) {
    for (const [id, name, sede] of DEMO_EMPLOYEES) {
      await pool.query(
        "INSERT INTO employees(id, name, sede, status) VALUES ($1,$2,$3,'neutral')",
        [id, name, sede]
      );
    }
  }

  const { rows: metaRows } = await pool.query("SELECT value FROM meta WHERE key='company'");
  if (metaRows.length === 0) {
    await pool.query("INSERT INTO meta(key, value) VALUES ('company', $1)", ["Mi Empresa"]);
  }
}

module.exports = { pool, init };
