UPDATE sow s
SET 
    actual_hours = agg.total_duration,
    actual_start = agg.min_checkin::date
FROM (
    SELECT 
        order_no,
        operation_no,
        SUM(duration) AS total_duration,
        MIN(longdate_checkin) AS min_checkin
    FROM timesheet_transaction
    WHERE 
        order_no IS NOT NULL
        AND operation_no IS NOT NULL
    GROUP BY 
        order_no, operation_no
) agg
WHERE 
    s.order_no = agg.order_no
    AND s.operation_no = agg.operation_no;


ALTER TABLE timesheet_transaction
ADD COLUMN modified_at TIMESTAMP DEFAULT NOW();

CREATE INDEX idx_timesheet_modified 
ON timesheet_transaction (modified_at);

CREATE OR REPLACE FUNCTION set_modified_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.modified_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_modified_at
BEFORE UPDATE ON timesheet_transaction
FOR EACH ROW
EXECUTE FUNCTION set_modified_at();