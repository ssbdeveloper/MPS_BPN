---
type: concept
tags: [payroll, timesheet, sap]
updated: 2026-07-11
---

# Jalur Data Payroll (yang tidak boleh rusak)

Jam kerja → gaji insentif mengalir lewat dua jalur:

```
LABOUR : tablet NFC → POST /timesheet → timesheet_transaction
          → (seharusnya) sap_timesheet_staging → post_sap_staging.py → SAP CPI
          → (kenyataan hari ini) API postToSap langsung → SAP CPI → log_timesheet_sap
MACHINE: SQL Server SSB_OEE → jobs/etl → mch_productiondata → mch_transaction
          → staging → SAP
KPI/EWS: keduanya + ews.shift_roster → ewsCalculator → ews.kpi_snapshot (BUKAN sumber payroll)
```

**Fakta kunci:**
- Identitas operator = kartu NFC di payload (`serialnumber` → `usernfc.snssb`), bukan sesi HTTP.
  FK `fk_timesheet_user` sudah VALIDATED (2026-07-11); `snssb` NOT NULL.
- `sow_standard(component_id, operation_no)` kini UNIQUE — duplikat std hours = math insentif ambigu.
- Dua jalur posting SAP masih koeksis; yang hidup operasional = API path (`log_timesheet_sap` terisi,
  staging kosong). Konsolidasi = [[REFACTOR_PLAN]] A-R3.
- Kolom `date_checkin` dkk (text) redundan tapi konsisten dgn `longdate_*` — deprecate pelan.
- `ews.kpi_snapshot` punya carry-forward saat error → jangan pernah dibaca untuk gaji.

**Terhubung:** [[concepts/order-no-spine]] · [[security/AUTH_RBAC_DESIGN]] (write ke jalur ini
sedang diamankan) · [[timesheet/UAT_SAP_POSTING]]

**Asal-usul:** [[REFACTOR_PLAN]] §2 (2026-07-07) · [[log/2026-07-11-refactor-phase1]]
