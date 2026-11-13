CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id               SERIAL PRIMARY KEY,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  params           JSONB NOT NULL,
  work_units       DOUBLE PRECISION NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued'CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress         REAL NOT NULL DEFAULT 0,
  result           JSONB,
  error            TEXT,
  cancel_requested BOOLEAN NOT NULL DEFAULT false,
  worker_id        TEXT,
  est_duration_ms  INT NOT NULL,               
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_status_created_idx ON tasks (status, created_at);
CREATE INDEX tasks_user_idx ON tasks (user_id, created_at DESC);
CREATE INDEX tasks_worker_idx ON tasks (worker_id) WHERE status = 'running';

CREATE TABLE workers (
  id             TEXT PRIMARY KEY,
  concurrency    INT NOT NULL,
  running        INT NOT NULL DEFAULT 0,
  is_dynamic     BOOLEAN NOT NULL DEFAULT false,  
  draining       BOOLEAN NOT NULL DEFAULT false,    
  status         TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline')),
  load1          REAL NOT NULL DEFAULT 0,
  mem_mb         REAL NOT NULL DEFAULT 0,
  tasks_done     INT NOT NULL DEFAULT 0,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE metrics (
  ts       TIMESTAMPTZ PRIMARY KEY DEFAULT now(),
  queued   INT NOT NULL,
  running  INT NOT NULL,
  workers  INT NOT NULL,
  capacity INT NOT NULL
);
