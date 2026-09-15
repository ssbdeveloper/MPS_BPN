-- Drop existing tables if they exist
DROP TABLE IF EXISTS mch_ProductionData CASCADE;
DROP TABLE IF EXISTS mch_StatusTypes CASCADE;
DROP TABLE IF EXISTS mch_Machines CASCADE;

-- Create mch_Machines table
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

-- Create mch_StatusTypes table
CREATE TABLE mch_StatusTypes (
    StatusID INT PRIMARY KEY,
    MainStatusID INT,
    Description VARCHAR(100)
);

-- Create mch_ProductionData table
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

-- Import data from Machines.csv
\COPY mch_Machines FROM 'd:\website\MPS2\database\machinehours\Machines.csv' WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL 'NULL');

-- Import data from StatusTypes.csv
\COPY mch_StatusTypes FROM 'd:\website\MPS2\database\machinehours\StatusTypes.csv' WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL 'NULL');

-- Import data from ProductionData.csv
\COPY mch_ProductionData FROM 'd:\website\MPS2\database\machinehours\ProductionData.csv' WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL 'NULL');

-- Verify data was imported
SELECT 'mch_Machines' as table_name, COUNT(*) as row_count FROM mch_Machines
UNION ALL
SELECT 'mch_StatusTypes', COUNT(*) FROM mch_StatusTypes
UNION ALL
SELECT 'mch_ProductionData', COUNT(*) FROM mch_ProductionData;
