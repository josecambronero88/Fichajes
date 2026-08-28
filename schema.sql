-- Esquema de la base de datos de fichajes.
-- Se ejecuta automáticamente al arrancar el servidor si las tablas no existen.

CREATE TABLE IF NOT EXISTS sedes (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sede TEXT,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'neutral',
  since TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  location TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_employee ON history(employee_id);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
