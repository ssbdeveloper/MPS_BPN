CREATE OR ALTER   VIEW vDrainduration
AS
SELECT 
    CAST(p.startdatetime AS DATE) AS work_date,
    p.statusid,
    st.description AS status_description,
    p.machineno,
    m.machineid,
    m.machinename,
    COALESCE(NULLIF(m.description, ''), m.machinename) AS machine_description,
    m.plantid,
    p.operatorid,
    p.jobid,
    COUNT(*) AS event_count,
    SUM(CASE WHEN p.enddatetime IS NULL THEN 1 ELSE 0 END) AS open_event_count,
    MIN(p.startdatetime) AS first_startdatetime,
    MAX(p.enddatetime) AS last_enddatetime,

    SUM(
        CASE
            WHEN p.enddatetime IS NULL THEN 0
            ELSE DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
        END
    ) AS duration_seconds,

    ROUND(
        CAST(
            SUM(
                CASE
                    WHEN p.enddatetime IS NULL THEN 0
                    ELSE DATEDIFF(SECOND, p.startdatetime, p.enddatetime)
                END
            ) AS NUMERIC(18, 4)
        ) / 3600.0,
        4
    ) AS duration_hours
FROM 
    ProductionData p
    LEFT JOIN Machines m ON m.machineno = p.machineno
    LEFT JOIN StatusTypes st ON st.statusid = p.statusid
WHERE 
    p.startdatetime IS NOT NULL
GROUP BY 
    CAST(p.startdatetime AS DATE),
    p.statusid,
    st.description,
    p.machineno,
    m.machineid,
    m.machinename,
    COALESCE(NULLIF(m.description, ''), m.machinename),
    m.plantid,
    p.operatorid,
    p.jobid;