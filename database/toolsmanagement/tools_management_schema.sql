-- Tools management database design
-- Target database: PostgreSQL
--
-- Existing project user model:
-- - public.usernfc = field users / orang lapangan
--   key columns: snssb, nfcid, full_name, machineid, machinename, workcenter, roles
-- - public.users = office users / admin-office users
--   key columns: id, username, name, role, roles
--
-- User references in this schema are intentionally "soft joins":
-- - No FK to public.usernfc or public.users, so historical tool records survive user cleanup/rename.
-- - Join by requester_field_snssb = public.usernfc.snssb.
-- - Join by requester_office_user_id = public.users.id.
--
-- Source files reviewed:
-- - alat ukur.csv: Code, Category, DESCRIPTION, RANGE, Condition, ID
-- - hand tool.csv: Description, CATEGORY, Ukuran, Qty
-- - power tools.csv: code, CATEGORY, Description, Type, Location, Condition, Note
-- - tap drill.csv: CATEGORY, Description, Classification, Terpakai, Satuan (Terpakai), Notes
--
-- Location table is intentionally omitted per requirement. Current responsibility is tracked by user,
-- status, condition, reservation, transaction, handover, and status logs.

CREATE SCHEMA IF NOT EXISTS tools_management;
SET search_path TO tools_management;

CREATE TABLE IF NOT EXISTS tool_categories (
  category_id BIGSERIAL PRIMARY KEY,
  category_code VARCHAR(50) NOT NULL UNIQUE,
  category_name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tool_conditions (
  condition_id SMALLSERIAL PRIMARY KEY,
  condition_code VARCHAR(50) NOT NULL UNIQUE,
  condition_name VARCHAR(100) NOT NULL,
  is_usable BOOLEAN NOT NULL DEFAULT true,
  sort_order SMALLINT NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS tools (
  tool_id BIGSERIAL PRIMARY KEY,

  -- System and source identifiers.
  asset_tag VARCHAR(100) NOT NULL UNIQUE,
  tool_code VARCHAR(100),
  source_file VARCHAR(100),
  source_row_number INT,
  source_id VARCHAR(50),

  -- Unified attributes from the four CSV files.
  category_id BIGINT NOT NULL REFERENCES tool_categories(category_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  tool_name VARCHAR(255) NOT NULL,
  tool_type VARCHAR(100),
  classification VARCHAR(100),
  measurement_range VARCHAR(100),
  size_label VARCHAR(100),
  specification TEXT,
  notes TEXT,

  -- Inventory and monitoring.
  is_serialized BOOLEAN NOT NULL DEFAULT true,
  quantity_total NUMERIC(12, 2) NOT NULL DEFAULT 1,
  quantity_available NUMERIC(12, 2) NOT NULL DEFAULT 1,
  unit VARCHAR(30) NOT NULL DEFAULT 'pcs',
  condition_id SMALLINT REFERENCES tool_conditions(condition_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  availability_status VARCHAR(30) NOT NULL DEFAULT 'available',

  -- Soft responsibility tracking.
  responsible_field_snssb TEXT,
  responsible_office_user_id INT,
  responsible_snapshot_name TEXT,

  purchased_at DATE,
  last_calibration_at DATE,
  next_calibration_at DATE,
  retired_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tools_quantity_total_non_negative CHECK (quantity_total >= 0),
  CONSTRAINT tools_quantity_available_valid CHECK (
    quantity_available >= 0 AND quantity_available <= quantity_total
  ),
  CONSTRAINT tools_availability_status_check CHECK (
    availability_status IN (
      'available',
      'reserved',
      'borrowed',
      'handover_pending',
      'maintenance',
      'calibration',
      'broken',
      'lost',
      'retired'
    )
  ),
  CONSTRAINT tools_serialized_quantity_check CHECK (
    is_serialized = false OR quantity_total = 1
  ),
  CONSTRAINT tools_single_responsible_party CHECK (
    responsible_field_snssb IS NULL OR responsible_office_user_id IS NULL
  ),
  CONSTRAINT tools_source_row_unique UNIQUE (source_file, source_row_number)
);

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id BIGSERIAL PRIMARY KEY,
  reservation_no VARCHAR(80) NOT NULL UNIQUE,
  tool_id BIGINT NOT NULL REFERENCES tools(tool_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  -- Soft requester joins. Field users usually request tools; office users can request/admin-create too.
  requester_field_snssb TEXT,
  requester_office_user_id INT,
  requester_snapshot_name TEXT,
  requester_snapshot_workcenter TEXT,
  requester_snapshot_role TEXT,

  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reserved_from TIMESTAMPTZ NOT NULL,
  reserved_until TIMESTAMPTZ NOT NULL,
  approved_by_office_user_id INT,
  approved_at TIMESTAMPTZ,
  fulfilled_transaction_id BIGINT,
  purpose TEXT,
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reservations_quantity_positive CHECK (quantity > 0),
  CONSTRAINT reservations_requester_required CHECK (
    requester_field_snssb IS NOT NULL OR requester_office_user_id IS NOT NULL
  ),
  CONSTRAINT reservations_single_requester CHECK (
    requester_field_snssb IS NULL OR requester_office_user_id IS NULL
  ),
  CONSTRAINT reservations_time_valid CHECK (reserved_until > reserved_from),
  CONSTRAINT reservations_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'fulfilled')
  )
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id BIGSERIAL PRIMARY KEY,
  transaction_no VARCHAR(80) NOT NULL UNIQUE,
  reservation_id BIGINT REFERENCES reservations(reservation_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  tool_id BIGINT NOT NULL REFERENCES tools(tool_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  -- Borrower can be field or office. Field borrower is expected for orang lapangan.
  borrower_field_snssb TEXT,
  borrower_office_user_id INT,
  borrower_snapshot_name TEXT,
  borrower_snapshot_workcenter TEXT,
  borrower_snapshot_role TEXT,

  -- Office/user who physically or administratively issued/received the tool.
  issued_by_office_user_id INT,
  issued_by_field_snssb TEXT,
  returned_to_office_user_id INT,
  returned_to_field_snssb TEXT,

  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  borrowed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  checkout_condition_id SMALLINT REFERENCES tool_conditions(condition_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  return_condition_id SMALLINT REFERENCES tool_conditions(condition_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  purpose TEXT,
  checkout_notes TEXT,
  return_notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'borrowed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT transactions_quantity_positive CHECK (quantity > 0),
  CONSTRAINT transactions_borrower_required CHECK (
    borrower_field_snssb IS NOT NULL OR borrower_office_user_id IS NOT NULL
  ),
  CONSTRAINT transactions_single_borrower CHECK (
    borrower_field_snssb IS NULL OR borrower_office_user_id IS NULL
  ),
  CONSTRAINT transactions_status_check CHECK (
    status IN ('borrowed', 'returned', 'overdue', 'lost', 'cancelled')
  ),
  CONSTRAINT transactions_return_after_borrow CHECK (
    returned_at IS NULL OR returned_at >= borrowed_at
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'tools_management'
      AND table_name = 'reservations'
      AND constraint_name = 'reservations_fulfilled_transaction_fk'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_fulfilled_transaction_fk
      FOREIGN KEY (fulfilled_transaction_id)
      REFERENCES transactions(transaction_id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS handover_logs (
  handover_id BIGSERIAL PRIMARY KEY,
  handover_no VARCHAR(80) NOT NULL UNIQUE,
  transaction_id BIGINT REFERENCES transactions(transaction_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  tool_id BIGINT NOT NULL REFERENCES tools(tool_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  -- Handover responsibility is between users. Usually field -> field, but office is supported.
  from_field_snssb TEXT,
  from_office_user_id INT,
  from_snapshot_name TEXT,
  from_snapshot_workcenter TEXT,
  to_field_snssb TEXT,
  to_office_user_id INT,
  to_snapshot_name TEXT,
  to_snapshot_workcenter TEXT,

  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handed_over_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  processed_by_office_user_id INT,
  processed_by_field_snssb TEXT,
  condition_id SMALLINT REFERENCES tool_conditions(condition_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  quantity NUMERIC(12, 2) NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT handover_from_required CHECK (
    from_field_snssb IS NOT NULL OR from_office_user_id IS NOT NULL
  ),
  CONSTRAINT handover_to_required CHECK (
    to_field_snssb IS NOT NULL OR to_office_user_id IS NOT NULL
  ),
  CONSTRAINT handover_single_from CHECK (
    from_field_snssb IS NULL OR from_office_user_id IS NULL
  ),
  CONSTRAINT handover_single_to CHECK (
    to_field_snssb IS NULL OR to_office_user_id IS NULL
  ),
  CONSTRAINT handover_not_same_field_user CHECK (
    from_field_snssb IS NULL OR to_field_snssb IS NULL OR from_field_snssb <> to_field_snssb
  ),
  CONSTRAINT handover_not_same_office_user CHECK (
    from_office_user_id IS NULL OR to_office_user_id IS NULL OR from_office_user_id <> to_office_user_id
  ),
  CONSTRAINT handover_quantity_positive CHECK (quantity > 0),
  CONSTRAINT handover_status_check CHECK (
    status IN ('pending', 'handed_over', 'accepted', 'rejected', 'cancelled')
  ),
  CONSTRAINT handover_received_after_request CHECK (
    received_at IS NULL OR received_at >= requested_at
  )
);

CREATE TABLE IF NOT EXISTS tool_status_logs (
  status_log_id BIGSERIAL PRIMARY KEY,
  tool_id BIGINT NOT NULL REFERENCES tools(tool_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  reservation_id BIGINT REFERENCES reservations(reservation_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  transaction_id BIGINT REFERENCES transactions(transaction_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  handover_id BIGINT REFERENCES handover_logs(handover_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  event_type VARCHAR(40) NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  condition_id SMALLINT REFERENCES tool_conditions(condition_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  availability_status VARCHAR(30),

  -- Soft user movement / actor tracking.
  from_field_snssb TEXT,
  from_office_user_id INT,
  to_field_snssb TEXT,
  to_office_user_id INT,
  created_by_field_snssb TEXT,
  created_by_office_user_id INT,
  actor_snapshot_name TEXT,

  quantity_delta NUMERIC(12, 2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tool_status_logs_event_type_check CHECK (
    event_type IN (
      'created',
      'reserved',
      'reservation_approved',
      'reservation_rejected',
      'reservation_cancelled',
      'reservation_expired',
      'borrowed',
      'returned',
      'handover_requested',
      'handover_accepted',
      'handover_rejected',
      'condition_changed',
      'maintenance_started',
      'maintenance_finished',
      'calibration_started',
      'calibration_finished',
      'lost',
      'retired',
      'stock_adjusted'
    )
  ),
  CONSTRAINT tool_status_logs_availability_check CHECK (
    availability_status IS NULL OR availability_status IN (
      'available',
      'reserved',
      'borrowed',
      'handover_pending',
      'maintenance',
      'calibration',
      'broken',
      'lost',
      'retired'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_tools_category_id ON tools(category_id);
CREATE INDEX IF NOT EXISTS idx_tools_tool_code ON tools(tool_code);
CREATE INDEX IF NOT EXISTS idx_tools_tool_name ON tools(tool_name);
CREATE INDEX IF NOT EXISTS idx_tools_condition_id ON tools(condition_id);
CREATE INDEX IF NOT EXISTS idx_tools_responsible_field_snssb ON tools(responsible_field_snssb);
CREATE INDEX IF NOT EXISTS idx_tools_responsible_office_user_id ON tools(responsible_office_user_id);
CREATE INDEX IF NOT EXISTS idx_tools_availability_status ON tools(availability_status);

CREATE INDEX IF NOT EXISTS idx_reservations_tool_id ON reservations(tool_id);
CREATE INDEX IF NOT EXISTS idx_reservations_field_snssb ON reservations(requester_field_snssb);
CREATE INDEX IF NOT EXISTS idx_reservations_office_user_id ON reservations(requester_office_user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_reserved_window ON reservations(tool_id, reserved_from, reserved_until);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_requested_at ON reservations(requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_reservation_id ON transactions(reservation_id);
CREATE INDEX IF NOT EXISTS idx_transactions_tool_id ON transactions(tool_id);
CREATE INDEX IF NOT EXISTS idx_transactions_borrower_field_snssb ON transactions(borrower_field_snssb);
CREATE INDEX IF NOT EXISTS idx_transactions_borrower_office_user_id ON transactions(borrower_office_user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_borrowed_at ON transactions(borrowed_at);
CREATE INDEX IF NOT EXISTS idx_transactions_expected_return_at ON transactions(expected_return_at);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_open_by_tool ON transactions(tool_id, status)
  WHERE status IN ('borrowed', 'overdue');

CREATE INDEX IF NOT EXISTS idx_handover_logs_tool_id ON handover_logs(tool_id);
CREATE INDEX IF NOT EXISTS idx_handover_logs_transaction_id ON handover_logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_handover_logs_from_field_snssb ON handover_logs(from_field_snssb);
CREATE INDEX IF NOT EXISTS idx_handover_logs_to_field_snssb ON handover_logs(to_field_snssb);
CREATE INDEX IF NOT EXISTS idx_handover_logs_from_office_user_id ON handover_logs(from_office_user_id);
CREATE INDEX IF NOT EXISTS idx_handover_logs_to_office_user_id ON handover_logs(to_office_user_id);
CREATE INDEX IF NOT EXISTS idx_handover_logs_requested_at ON handover_logs(requested_at);
CREATE INDEX IF NOT EXISTS idx_handover_logs_status ON handover_logs(status);

CREATE INDEX IF NOT EXISTS idx_tool_status_logs_tool_id_event_at ON tool_status_logs(tool_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_status_logs_reservation_id ON tool_status_logs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_tool_status_logs_transaction_id ON tool_status_logs(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tool_status_logs_handover_id ON tool_status_logs(handover_id);
CREATE INDEX IF NOT EXISTS idx_tool_status_logs_event_type ON tool_status_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_tool_status_logs_created_by_field_snssb ON tool_status_logs(created_by_field_snssb);
CREATE INDEX IF NOT EXISTS idx_tool_status_logs_created_by_office_user_id ON tool_status_logs(created_by_office_user_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tool_categories_updated_at ON tool_categories;
CREATE TRIGGER trg_tool_categories_updated_at
BEFORE UPDATE ON tool_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_tools_updated_at ON tools;
CREATE TRIGGER trg_tools_updated_at
BEFORE UPDATE ON tools
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
BEFORE UPDATE ON reservations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_handover_logs_updated_at ON handover_logs;
CREATE TRIGGER trg_handover_logs_updated_at
BEFORE UPDATE ON handover_logs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW v_tools_with_responsible_user AS
SELECT
  t.*,
  fn.full_name AS responsible_field_name,
  fn.nfcid AS responsible_field_nfcid,
  fn.workcenter AS responsible_field_workcenter,
  fn.roles AS responsible_field_role,
  ou.username AS responsible_office_username,
  ou.name AS responsible_office_name,
  ou.role AS responsible_office_role
FROM tools t
LEFT JOIN public.usernfc fn
  ON fn.snssb = t.responsible_field_snssb
LEFT JOIN public.users ou
  ON ou.id = t.responsible_office_user_id;

CREATE OR REPLACE VIEW v_reservations_with_users AS
SELECT
  r.*,
  t.asset_tag,
  t.tool_code,
  t.tool_name,
  fn.full_name AS requester_field_name,
  fn.nfcid AS requester_field_nfcid,
  fn.workcenter AS requester_field_workcenter,
  fn.roles AS requester_field_role,
  ou.username AS requester_office_username,
  ou.name AS requester_office_name,
  approver.username AS approved_by_username,
  approver.name AS approved_by_name
FROM reservations r
JOIN tools t
  ON t.tool_id = r.tool_id
LEFT JOIN public.usernfc fn
  ON fn.snssb = r.requester_field_snssb
LEFT JOIN public.users ou
  ON ou.id = r.requester_office_user_id
LEFT JOIN public.users approver
  ON approver.id = r.approved_by_office_user_id;

CREATE OR REPLACE VIEW v_transactions_with_users AS
SELECT
  tr.*,
  t.asset_tag,
  t.tool_code,
  t.tool_name,
  fn.full_name AS borrower_field_name,
  fn.nfcid AS borrower_field_nfcid,
  fn.workcenter AS borrower_field_workcenter,
  fn.roles AS borrower_field_role,
  ou.username AS borrower_office_username,
  ou.name AS borrower_office_name
FROM transactions tr
JOIN tools t
  ON t.tool_id = tr.tool_id
LEFT JOIN public.usernfc fn
  ON fn.snssb = tr.borrower_field_snssb
LEFT JOIN public.users ou
  ON ou.id = tr.borrower_office_user_id;

CREATE OR REPLACE VIEW v_handover_logs_with_users AS
SELECT
  h.*,
  t.asset_tag,
  t.tool_code,
  t.tool_name,
  from_field.full_name AS from_field_name,
  from_field.nfcid AS from_field_nfcid,
  from_field.workcenter AS from_field_workcenter,
  from_office.username AS from_office_username,
  from_office.name AS from_office_name,
  to_field.full_name AS to_field_name,
  to_field.nfcid AS to_field_nfcid,
  to_field.workcenter AS to_field_workcenter,
  to_office.username AS to_office_username,
  to_office.name AS to_office_name
FROM handover_logs h
JOIN tools t
  ON t.tool_id = h.tool_id
LEFT JOIN public.usernfc from_field
  ON from_field.snssb = h.from_field_snssb
LEFT JOIN public.users from_office
  ON from_office.id = h.from_office_user_id
LEFT JOIN public.usernfc to_field
  ON to_field.snssb = h.to_field_snssb
LEFT JOIN public.users to_office
  ON to_office.id = h.to_office_user_id;

INSERT INTO tool_categories (category_code, category_name)
VALUES
  ('MEASURE_TOOL', 'Measure Tool'),
  ('HAND_TOOL', 'Hand Tool'),
  ('POWERTOOL', 'Power Tool'),
  ('TAP', 'Tap'),
  ('DRILL', 'Drill')
ON CONFLICT (category_code) DO NOTHING;

INSERT INTO tool_conditions (condition_code, condition_name, is_usable, sort_order)
VALUES
  ('GOOD', 'Good', true, 10),
  ('NOT_GOOD', 'Not Good', false, 20),
  ('BROKEN', 'Broken', false, 30),
  ('ON_CALIBRATION', 'On Calibration', false, 40),
  ('BORROWED_TO_OTHER_SITE', 'Sedang Dipinjamkan Ke Site Lain', false, 50),
  ('UNKNOWN', 'Unknown', false, 999)
ON CONFLICT (condition_code) DO NOTHING;

-- Reservation availability rule:
-- before approving a reservation, check overlapping active reservations:
--
-- SELECT COALESCE(SUM(quantity), 0) AS reserved_qty
-- FROM tools_management.reservations
-- WHERE tool_id = :tool_id
--   AND status IN ('pending', 'approved')
--   AND tstzrange(reserved_from, reserved_until, '[)') && tstzrange(:reserved_from, :reserved_until, '[)');
--
-- Available during requested window:
-- tools.quantity_total - reserved_qty - currently_borrowed_qty

-- Suggested import mapping into `tools`:
--
-- alat ukur.csv
--   asset_tag           = COALESCE(Code, 'MEASURE-' || lpad(row_number::text, 6, '0'))
--   tool_code           = Code
--   source_id           = ID
--   category            = MEASURE_TOOL
--   tool_name           = DESCRIPTION
--   measurement_range   = RANGE
--   condition           = Condition
--   quantity_total      = 1
--   unit                = pcs
--   is_serialized       = true
--
-- hand tool.csv
--   asset_tag           = 'HAND-' || lpad(row_number::text, 6, '0')
--   category            = HAND_TOOL
--   tool_name           = Description
--   size_label          = Ukuran
--   quantity_total      = Qty
--   quantity_available  = Qty
--   unit                = pcs
--   is_serialized       = false
--
-- power tools.csv
--   asset_tag           = COALESCE(code, 'POWER-' || lpad(row_number::text, 6, '0'))
--   tool_code           = code
--   category            = POWERTOOL
--   tool_name           = Description
--   tool_type           = Type
--   condition           = Condition
--   notes               = Note
--   quantity_total      = 1
--   unit                = pcs
--   is_serialized       = true
--
-- tap drill.csv
--   asset_tag           = upper(CATEGORY) || '-' || lpad(row_number::text, 6, '0')
--   category            = CATEGORY, either TAP or DRILL
--   tool_name           = Description
--   classification      = Classification
--   quantity_total      = COALESCE(Terpakai, 0)
--   quantity_available  = COALESCE(Terpakai, 0)
--   unit                = COALESCE(Satuan (Terpakai), 'pcs')
--   notes               = Notes
--   is_serialized       = false
