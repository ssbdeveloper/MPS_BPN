BEGIN;

CREATE TABLE IF NOT EXISTS ews.roster_calendar_exception (
  business_date date PRIMARY KEY,
  runs_day boolean NOT NULL,
  runs_night boolean NOT NULL,
  reason text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reason IS NULL OR char_length(reason) <= 120)
);

COMMIT;
