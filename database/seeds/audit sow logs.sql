-- Function Audit table SOW
CREATE OR REPLACE FUNCTION public.log_sow_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN

    IF TG_OP = 'INSERT' THEN
        INSERT INTO sow_logs (
            table_name,
            record_id,
            action,
            old_data,
            new_data,
            changed_by
        )
        VALUES (
            TG_TABLE_NAME,
            NEW.idsow,
            'CREATE',
            NULL,
            to_jsonb(NEW),
            current_user
        );

        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO sow_logs (
            table_name,
            record_id,
            action,
            old_data,
            new_data,
            changed_by
        )
        VALUES (
            TG_TABLE_NAME,
            NEW.idsow,
            'UPDATE',
            to_jsonb(OLD),
            to_jsonb(NEW),
            current_user
        );

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO sow_logs (
            table_name,
            record_id,
            action,
            old_data,
            new_data,
            changed_by
        )
        VALUES (
            TG_TABLE_NAME,
            OLD.idsow,
            'DELETE',
            to_jsonb(OLD),
            NULL,
            current_user
        );

        RETURN OLD;
    END IF;

    RETURN NULL;

END;
$$;

-- Add Trigger for audit trail
CREATE TRIGGER sow_audit_trigger
AFTER INSERT OR UPDATE OR DELETE
ON sow
FOR EACH ROW
EXECUTE FUNCTION log_sow_changes();



-- AUDIT SQL COMMAND --
SELECT
    l.log_id,
    l.action,
    l.changed_by,
    l.changed_at,
    key AS field,
    l.old_data->>key AS old_value,
    l.new_data->>key AS new_value
FROM sow_logs l
LEFT JOIN LATERAL jsonb_object_keys(
    COALESCE(l.new_data, l.old_data)
) AS key ON TRUE
WHERE
    (l.old_data->>key IS DISTINCT FROM l.new_data->>key)
    AND COALESCE(l.new_data->>'order_no', l.old_data->>'order_no') = 'PO12345'
ORDER BY l.changed_at DESC;

