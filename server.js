require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { pool, init } = require("./db");

const app = express();
app.use(express.json({ limit: "4mb" })); // fotos comprimidas como data URL
app.use(express.static(path.join(__dirname, "public")));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next(); // sin contraseña configurada = panel abierto
  const supplied = req.header("x-admin-password") || "";
  if (supplied && timingSafeEqual(supplied, ADMIN_PASSWORD)) return next();
  return res.status(401).json({ error: "unauthorized" });
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function uid(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

async function fullState() {
  const [sedes, employees, history, meta] = await Promise.all([
    pool.query("SELECT name FROM sedes ORDER BY name ASC"),
    pool.query("SELECT id, name, sede, photo, status, since FROM employees ORDER BY name ASC"),
    pool.query("SELECT id, employee_id AS \"employeeId\", name, type, timestamp, location FROM history ORDER BY timestamp DESC LIMIT 5000"),
    pool.query("SELECT value FROM meta WHERE key='company'"),
  ]);
  return {
    company: meta.rows[0] ? meta.rows[0].value : "Mi Empresa",
    sedes: sedes.rows.map((r) => r.name),
    employees: employees.rows,
    history: history.rows,
    adminProtected: !!ADMIN_PASSWORD,
  };
}

async function recomputeStatus(employeeId) {
  const { rows } = await pool.query(
    "SELECT type, timestamp FROM history WHERE employee_id=$1 ORDER BY timestamp DESC LIMIT 1",
    [employeeId]
  );
  if (rows.length === 0) {
    await pool.query("UPDATE employees SET status='neutral', since=NULL WHERE id=$1", [employeeId]);
  } else {
    await pool.query("UPDATE employees SET status=$1, since=$2 WHERE id=$3", [
      rows[0].type,
      rows[0].timestamp,
      employeeId,
    ]);
  }
}

// ---------- Estado completo (polling) ----------
app.get("/api/state", async (req, res) => {
  try {
    res.json(await fullState());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Admin login (solo valida, no crea sesión persistente) ----------
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) return res.json({ ok: true, protected: false });
  if (password && timingSafeEqual(password, ADMIN_PASSWORD)) {
    return res.json({ ok: true, protected: true });
  }
  return res.status(401).json({ ok: false, error: "wrong_password" });
});

// ---------- Fichar (abierto a cualquiera, sin PIN) ----------
app.post("/api/punch", async (req, res) => {
  try {
    const { employeeId, location } = req.body || {};
    const { rows } = await pool.query("SELECT status FROM employees WHERE id=$1", [employeeId]);
    if (rows.length === 0) return res.status(404).json({ error: "not_found" });
    const newType = rows[0].status === "in" ? "out" : "in";
    const rec = { id: uid("h"), employeeId, type: newType, timestamp: new Date().toISOString(), location: location || "" };
    const { rows: nameRows } = await pool.query("SELECT name FROM employees WHERE id=$1", [employeeId]);
    const name = nameRows[0].name;
    await pool.query(
      "INSERT INTO history(id, employee_id, name, type, timestamp, location) VALUES ($1,$2,$3,$4,$5,$6)",
      [rec.id, employeeId, name, newType, rec.timestamp, rec.location]
    );
    await recomputeStatus(employeeId);
    res.json({ ok: true, record: { ...rec, name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Empleados (admin) ----------
app.post("/api/employees", requireAdmin, async (req, res) => {
  try {
    const { name, sede, photo } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name_required" });
    const id = uid("e");
    await pool.query(
      "INSERT INTO employees(id, name, sede, photo, status) VALUES ($1,$2,$3,$4,'neutral')",
      [id, String(name).trim(), sede || null, photo || null]
    );
    res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

app.put("/api/employees/:id", requireAdmin, async (req, res) => {
  try {
    const { name, sede, photo } = req.body || {};
    const fields = [];
    const values = [];
    let i = 1;
    if (name !== undefined) { fields.push(`name=$${i++}`); values.push(String(name).trim()); }
    if (sede !== undefined) { fields.push(`sede=$${i++}`); values.push(sede); }
    if (photo !== undefined) { fields.push(`photo=$${i++}`); values.push(photo); }
    if (fields.length === 0) return res.json({ ok: true });
    values.push(req.params.id);
    await pool.query(`UPDATE employees SET ${fields.join(", ")} WHERE id=$${i}`, values);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

app.delete("/api/employees/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM employees WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Sedes (admin) ----------
app.post("/api/sedes", requireAdmin, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name_required" });
    await pool.query("INSERT INTO sedes(name) VALUES ($1) ON CONFLICT DO NOTHING", [String(name).trim()]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

app.put("/api/sedes/:name", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const oldName = req.params.name;
    const { newName } = req.body || {};
    if (!newName || !String(newName).trim()) return res.status(400).json({ error: "name_required" });
    const nn = String(newName).trim();
    await client.query("BEGIN");
    await client.query("UPDATE sedes SET name=$1 WHERE name=$2", [nn, oldName]);
    await client.query("UPDATE employees SET sede=$1 WHERE sede=$2", [nn, oldName]);
    await client.query("UPDATE history SET location=$1 WHERE location=$2", [nn, oldName]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

app.delete("/api/sedes/:name", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM sedes WHERE name=$1", [req.params.name]);
    await pool.query("UPDATE employees SET sede=NULL WHERE sede=$1", [req.params.name]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Historial: borrar un registro (corrección de errores) ----------
app.delete("/api/history/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT employee_id FROM history WHERE id=$1", [req.params.id]);
    await pool.query("DELETE FROM history WHERE id=$1", [req.params.id]);
    if (rows.length) await recomputeStatus(rows[0].employee_id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server_error" });
  }
});

const PORT = process.env.PORT || 3000;

init()
  .then(() => {
    app.listen(PORT, () => console.log(`Fichajes escuchando en el puerto ${PORT}`));
  })
  .catch((e) => {
    console.error("No se pudo inicializar la base de datos:", e);
    process.exit(1);
  });
