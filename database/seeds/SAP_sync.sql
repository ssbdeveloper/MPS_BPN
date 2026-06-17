CREATE TABLE qh3_order (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- DATA
    confirmation_number VARCHAR(20) NOT NULL,         -- RUECK
    indicator_code VARCHAR(20),                       -- ZINDICATOR
    operation_short_text TEXT,                        -- LTXA1
    order_no VARCHAR(20) NOT NULL,                    -- AUFNR
    operation_no VARCHAR(10) NOT NULL,                -- VORNR
    sequence_category VARCHAR(5),                     -- FLGAT
    sequence_number VARCHAR(20),                      -- PLNFL
    branch_operation_no VARCHAR(10),                  -- VORNR_B
    return_operation_no VARCHAR(10),                  -- VORNR_R
    material_no VARCHAR(50),                          -- MATNR
    material_description TEXT,                        -- MAKTX
    operation_description TEXT,                       -- ZTXT04_VORNR
    work_center VARCHAR(30),                          -- ARBPL
    cost_center VARCHAR(30),                          -- KOSTL
    plant_code VARCHAR(10),                           -- WERKS
    unit_of_measure VARCHAR(10),                      -- VGE01
    standard_value VARCHAR(30),                       -- VGW01
    order_type VARCHAR(10),                           -- AUART
    order_description TEXT,                           -- ZTXT04_AUFNR
    --status_etl VARCHAR(10) NOT NULL DEFAULT 'NEW',

    -- audit
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

--add(int(first(outputs('Get_rows')?['body/value'])?['id']), 1)