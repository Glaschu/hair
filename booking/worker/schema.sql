-- Phase 1 booking store.
--
-- Everything here is either a time or an envelope the server cannot open.
-- No client name, number, email or note is ever stored in readable form.

CREATE TABLE IF NOT EXISTS salon (
  id          TEXT PRIMARY KEY,          -- always 'me': one salon, her use case
  name        TEXT NOT NULL,
  public_key  TEXT NOT NULL,             -- her sealing key; the secret half stays on her devices
  policy      TEXT,                      -- cancellation terms, shown before anyone can book
  updated_at  INTEGER NOT NULL
);

-- The key her devices carry. Minted by the setup page on first sign-in and
-- rotated when she starts over, so nobody has to set or remember a secret.
CREATE TABLE IF NOT EXISTS service (
  id          TEXT PRIMARY KEY,          -- always 'me'
  device_key  TEXT NOT NULL,
  rotated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  token         TEXT PRIMARY KEY,        -- 128-bit random, unguessable
  client_ref    TEXT NOT NULL,           -- opaque; means something only inside iris
  greeting      TEXT,                    -- "Hi Sara" — a first name at most
  service_name  TEXT NOT NULL,
  duration_mins INTEGER NOT NULL,
  price         REAL NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS slots (
  id         TEXT PRIMARY KEY,
  token      TEXT NOT NULL REFERENCES links(token) ON DELETE CASCADE,
  starts_at  TEXT NOT NULL,              -- ISO 8601
  ends_at    TEXT NOT NULL,
  taken      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS slots_by_token ON slots(token);

CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL,
  slot_id     TEXT NOT NULL,
  client_ref  TEXT NOT NULL,             -- which client card this belongs to, in iris
  sealed      TEXT NOT NULL,             -- the envelope: opaque here, readable only on her devices
  created_at  INTEGER NOT NULL,
  agreed_at   INTEGER,                   -- when they ticked the cancellation terms
  seen_at     INTEGER                    -- set once iris has imported it
);
CREATE INDEX IF NOT EXISTS bookings_unseen ON bookings(seen_at);
