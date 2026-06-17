import psycopg2
import pandas as pd
import os

# Database connection parameters
conn_params = {
    'host': 'localhost',
    'database': 'ptssb',
    'user': 'postgres',
    'password': 'postgres',
    'port': 5432
}

# CSV files paths
csv_files = {
    'mch_Machines': r'd:\website\MPS2\database\machinehours\Machines.csv',
    'mch_StatusTypes': r'd:\website\MPS2\database\machinehours\StatusTypes.csv',
    'mch_ProductionData': r'd:\website\MPS2\database\machinehours\ProductionData.csv'
}

try:
    # Connect to database
    conn = psycopg2.connect(**conn_params)
    cursor = conn.cursor()
    print("✓ Connected to database: ptssb")

    # Drop existing tables
    cursor.execute("DROP TABLE IF EXISTS mch_ProductionData CASCADE;")
    cursor.execute("DROP TABLE IF EXISTS mch_StatusTypes CASCADE;")
    cursor.execute("DROP TABLE IF EXISTS mch_Machines CASCADE;")
    conn.commit()
    print("✓ Dropped existing tables")

    # Create mch_Machines table
    cursor.execute("""
        CREATE TABLE mch_Machines (
            MachineNo INT PRIMARY KEY,
            SiteMachineNo INT,
            MachineGroupID INT,
            PlantID INT,
            MachineTypeID INT,
            MachineID VARCHAR(50),
            MachineName VARCHAR(255),
            IPAddress VARCHAR(50),
            Description TEXT,
            Brand VARCHAR(100),
            ModelNumber VARCHAR(100),
            SerialNumber VARCHAR(100),
            BuildYear INT,
            mqtt_topic VARCHAR(255),
            mqtt_topic_param VARCHAR(255)
        );
    """)
    conn.commit()
    print("✓ Created table: mch_Machines")

    # Create mch_StatusTypes table
    cursor.execute("""
        CREATE TABLE mch_StatusTypes (
            StatusID INT PRIMARY KEY,
            MainStatusID INT,
            Description VARCHAR(100)
        );
    """)
    conn.commit()
    print("✓ Created table: mch_StatusTypes")

    # Create mch_ProductionData table
    cursor.execute("""
        CREATE TABLE mch_ProductionData (
            ProdDataID INT PRIMARY KEY,
            StartDateTime TIMESTAMP,
            EndDateTime TIMESTAMP,
            DurationSeconds INT,
            MachineNo INT REFERENCES mch_Machines(MachineNo),
            StatusID INT REFERENCES mch_StatusTypes(StatusID),
            PreviousStatusID INT,
            Duration INT,
            Notes TEXT,
            OperatorID VARCHAR(50),
            JobID VARCHAR(50),
            JobComplete VARCHAR(50)
        );
    """)
    conn.commit()
    print("✓ Created table: mch_ProductionData")

    # Import data from Machines.csv
    print("\nImporting Machines.csv...")
    df_machines = pd.read_csv(csv_files['mch_Machines'])
    df_machines = df_machines.where(pd.notnull(df_machines), None)
    for _, row in df_machines.iterrows():
        cursor.execute("""
            INSERT INTO mch_Machines VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, tuple(row))
    conn.commit()
    print(f"✓ Imported {len(df_machines)} rows to mch_Machines")

    # Import data from StatusTypes.csv
    print("Importing StatusTypes.csv...")
    df_status = pd.read_csv(csv_files['mch_StatusTypes'])
    df_status = df_status.where(pd.notnull(df_status), None)
    for _, row in df_status.iterrows():
        cursor.execute("""
            INSERT INTO mch_StatusTypes VALUES (%s, %s, %s)
        """, tuple(row))
    conn.commit()
    print(f"✓ Imported {len(df_status)} rows to mch_StatusTypes")

    # Import data from ProductionData.csv
    print("Importing ProductionData.csv...")
    df_prod = pd.read_csv(csv_files['mch_ProductionData'])
    df_prod = df_prod.where(pd.notnull(df_prod), None)
    for _, row in df_prod.iterrows():
        cursor.execute("""
            INSERT INTO mch_ProductionData VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, tuple(row))
    conn.commit()
    print(f"✓ Imported {len(df_prod)} rows to mch_ProductionData")

    # Verify imported data
    print("\n" + "="*50)
    print("SUMMARY:")
    print("="*50)

    cursor.execute("SELECT COUNT(*) FROM mch_Machines;")
    count_machines = cursor.fetchone()[0]
    print(f"mch_Machines: {count_machines} rows")

    cursor.execute("SELECT COUNT(*) FROM mch_StatusTypes;")
    count_status = cursor.fetchone()[0]
    print(f"mch_StatusTypes: {count_status} rows")

    cursor.execute("SELECT COUNT(*) FROM mch_ProductionData;")
    count_prod = cursor.fetchone()[0]
    print(f"mch_ProductionData: {count_prod} rows")

    print("="*50)
    print("✓ All data imported successfully!")

    cursor.close()
    conn.close()

except psycopg2.Error as e:
    print(f"✗ Database error: {e}")
except FileNotFoundError as e:
    print(f"✗ File not found: {e}")
except Exception as e:
    print(f"✗ Error: {e}")
