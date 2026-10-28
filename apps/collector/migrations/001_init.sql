-- Single human user. The fixed pk with check(id = 1) means at most one row, ever.
CREATE TABLE app_user (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email       text NOT NULL,
  pass_hash   text NOT NULL,
  must_change boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rigs (
  name       text PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

-- One row per miner instance; source/coin are free text so a new miner
-- source needs no schema change.
CREATE TABLE miners (
  rig        text NOT NULL REFERENCES rigs (name) ON DELETE CASCADE,
  source     text NOT NULL,
  coin       text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rig, source)
);

CREATE TABLE samples (
  ts       timestamptz NOT NULL,
  rig      text NOT NULL,
  source   text NOT NULL,
  coin     text NOT NULL,
  h10      double precision NOT NULL,
  h60      double precision NOT NULL,
  h15      double precision NOT NULL,
  good     int NOT NULL,
  rejected int NOT NULL
);

CREATE INDEX samples_rig_source_ts ON samples (rig, source, ts DESC);
CREATE INDEX samples_ts ON samples (ts DESC);
