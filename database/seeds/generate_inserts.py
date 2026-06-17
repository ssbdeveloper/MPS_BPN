import csv
import sys

# Read Machines.csv and generate bulk INSERT
machines_rows = []
with open('d:\\website\\MPS2\\database\\machinehours\\Machines.csv', 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Convert NULL strings to actual NULL
        def fmt(k):
            val = row.get(k, '')
            if val == 'NULL' or val == '':
                return 'NULL'
            # Escape single quotes in strings
            val = val.replace("'", "''")
            return f"'{val}'"

        row_vals = (
            row.get('MachineNo'),
            fmt('SiteMachineNo') if row.get('SiteMachineNo') != 'NULL' else 'NULL',
            fmt('MachineGroupID') if row.get('MachineGroupID') != 'NULL' else 'NULL',
            fmt('PlantID') if row.get('PlantID') != 'NULL' else 'NULL',
            fmt('MachineTypeID') if row.get('MachineTypeID') != 'NULL' else 'NULL',
            fmt('MachineID'),
            fmt('MachineName'),
            fmt('IPAddress'),
            fmt('Description'),
            fmt('Brand'),
            fmt('ModelNumber'),
            fmt('SerialNumber'),
            fmt('BuildYear') if row.get('BuildYear') != 'NULL' else 'NULL',
            fmt('mqtt_topic'),
            fmt('mqtt_topic_param')
        )
        machines_rows.append(f"({', '.join(str(v) for v in row_vals)})")

# Generate bulk INSERT statement
if machines_rows:
    bulk_insert = f"INSERT INTO mch_Machines VALUES " + ',\n'.join(machines_rows) + ";"
    print(bulk_insert)
    print(f"\n-- Total Machines rows: {len(machines_rows)}", file=sys.stderr)
