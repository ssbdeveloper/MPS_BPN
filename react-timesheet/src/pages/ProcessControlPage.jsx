import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Process Control Page
 * - Dummy data dari CSV database asli
 * - Layout parameter 3 kolom compact
 * - Step wizard: Category → Timesheet → Parameters
 */
const ProcessControlPage = () => {
  const navigate = useNavigate();

  // States
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [timesheets, setTimesheets] = useState([]);
  const [selectedTimesheet, setSelectedTimesheet] = useState(null);
  const [parameters, setParameters] = useState([]);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  // ====== DUMMY DATA DARI CSV ASLI ======

  const dummyCategories = [
    { id_process: '1', process_name: 'ID WELD' },
    { id_process: '2', process_name: 'SAW' },
    { id_process: '3', process_name: 'MACHINING' },
    { id_process: '4', process_name: 'General Welding' },
    { id_process: '5', process_name: 'HCP - Prepolish' },
    { id_process: '6', process_name: 'HCP - Plating' },
    { id_process: '7', process_name: 'HCP - Final Polish' },
    { id_process: '8', process_name: 'HCP - Stripping' },
    { id_process: '9', process_name: 'Arc Spray' },
  ];

  const dummyTimesheets = [
    {
      tsnumber: 7,
      production_order: '1000122336',
      ssbr_ident: 'SFRM-766',
      operation_text: 'Order / manufacture sleeve',
      seq: '20',
      workcentercode: 'M5153ASY',
      workcenterdescription: 'ASSEMBLY',
      full_name: 'tee',
      date_checkin: '04/02/2026',
      hour_checkin: '15.52',
    },
    {
      tsnumber: 5,
      production_order: '1000122336',
      ssbr_ident: 'SFRM-766',
      operation_text: 'Order / manufacture sleeve',
      seq: '20',
      workcentercode: 'M5153BSW',
      workcenterdescription: 'BANDSAW',
      full_name: 'Wira',
      date_checkin: '04/02/2026',
      hour_checkin: '12.18',
    },
  ];

  // Parameters per category — dari process_parameter CSV asli
  const dummyParametersMap = {
    // ID WELD (id_process=1)
    '1': [
      { id_parameter: '1', parameter_name: 'Pass No', isnumber: true, ischoice: false, uom: 'Number', parameter_no: 1 },
      { id_parameter: '2', parameter_name: 'Filler Material', isnumber: false, ischoice: true, uom: '', parameter_no: 2,
        choices: [
          { choice_name: 'KISWEL K71TLF' }, { choice_name: 'KISWEL E70MC' }, { choice_name: 'KISWEL K-110TK3' },
          { choice_name: 'ESAB ER309' }, { choice_name: 'ESAB ER316' }, { choice_name: 'ESAB E7IT-1C' },
          { choice_name: 'ESAB ULTRA E71T-1' }, { choice_name: 'KISWEL ER308' },
          { choice_name: 'BÖHLER Q 71.1 RC (M)' }, { choice_name: 'DUAL SHIELD II 100D1' },
          { choice_name: 'KISWEL K91TB3' }, { choice_name: 'DO*250' }, { choice_name: 'DO*23' },
        ]
      },
      { id_parameter: '3', parameter_name: 'Wire Diameter', isnumber: false, ischoice: true, uom: '', parameter_no: 3,
        choices: [
          { choice_name: '1,0 mm' }, { choice_name: '1,2 mm' }, { choice_name: '1,6 mm' },
          { choice_name: '2,4 mm' }, { choice_name: '3,2 mm' }, { choice_name: '4 mm' },
        ]
      },
      { id_parameter: '5', parameter_name: 'Diameter Before Welding', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 5 },
      { id_parameter: '6', parameter_name: 'Pre heat', isnumber: true, ischoice: false, uom: 'deg C', parameter_no: 6 },
      { id_parameter: '7', parameter_name: 'Gas Flowrate', isnumber: true, ischoice: false, uom: 'lpm', parameter_no: 7 },
      { id_parameter: '8', parameter_name: 'Amperage', isnumber: true, ischoice: false, uom: 'A', parameter_no: 8 },
      { id_parameter: '9', parameter_name: 'Voltage', isnumber: true, ischoice: false, uom: 'V', parameter_no: 9 },
      { id_parameter: '4', parameter_name: 'Control Speed', isnumber: true, ischoice: false, uom: 'Hz', parameter_no: 10 },
      { id_parameter: '10', parameter_name: 'Temperature After Welding', isnumber: true, ischoice: false, uom: 'deg C', parameter_no: 11 },
      { id_parameter: '11', parameter_name: 'Diameter After Welding', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 12 },
      { id_parameter: '12', parameter_name: 'Lenght Welding', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 13 },
      { id_parameter: '13', parameter_name: 'Operator Note', isnumber: false, ischoice: false, uom: '', parameter_no: 14 },
    ],
    // SAW (id_process=2)
    '2': [
      { id_parameter: '14', parameter_name: 'Filler Material', isnumber: false, ischoice: true, uom: '', parameter_no: 1,
        choices: [
          { choice_name: 'Bohler EM12K' }, { choice_name: 'Esab EM12K' }, { choice_name: 'Lincoln M12K' },
          { choice_name: 'Lincoln L60' }, { choice_name: 'Lincoln A96S' }, { choice_name: 'Lincore 40-S' }, { choice_name: 'TW-5172' },
        ]
      },
      { id_parameter: '144', parameter_name: 'Flux', isnumber: true, ischoice: true, uom: '', parameter_no: 2,
        choices: [
          { choice_name: 'LINCOLN A96S' }, { choice_name: 'SKC RECORD' }, { choice_name: 'UVC 401' }, { choice_name: 'PREMIERWELD NF-3 & BF-1' },
        ]
      },
      { id_parameter: '15', parameter_name: 'Wire Diameter', isnumber: false, ischoice: true, uom: '', parameter_no: 3,
        choices: [
          { choice_name: '1,0 mm' }, { choice_name: '1,2 mm' }, { choice_name: '1,6 mm' },
          { choice_name: '2,4 mm' }, { choice_name: '3,2 mm' }, { choice_name: '4 mm' },
        ]
      },
      { id_parameter: '21', parameter_name: 'Diameter Before Welding', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 5 },
      { id_parameter: '22', parameter_name: 'Pre heat', isnumber: true, ischoice: false, uom: 'deg C', parameter_no: 6 },
      { id_parameter: '23', parameter_name: 'Amperage', isnumber: true, ischoice: false, uom: 'A', parameter_no: 7 },
      { id_parameter: '24', parameter_name: 'Voltage', isnumber: true, ischoice: false, uom: 'V', parameter_no: 8 },
      { id_parameter: '18', parameter_name: 'Speed Frekuensi', isnumber: false, ischoice: false, uom: 'Hz', parameter_no: 9 },
      { id_parameter: '25', parameter_name: 'Temperature After Welding', isnumber: true, ischoice: false, uom: 'deg C', parameter_no: 11 },
      { id_parameter: '27', parameter_name: 'Diameter After Welding Area 1', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 12 },
      { id_parameter: '28', parameter_name: 'Diameter After Welding Area 2', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 13 },
      { id_parameter: '29', parameter_name: 'Lenght Welding', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 14 },
      { id_parameter: '31', parameter_name: 'Operator Note', isnumber: false, ischoice: false, uom: '', parameter_no: 15 },
    ],
    // MACHINING (id_process=3)
    '3': [
      { id_parameter: '16', parameter_name: 'Process Machining', isnumber: false, ischoice: true, uom: '', parameter_no: 1,
        choices: [ { choice_name: 'Roughing' }, { choice_name: 'Finishing' } ]
      },
      { id_parameter: '62', parameter_name: 'Material Type', isnumber: false, ischoice: true, uom: '', parameter_no: 2,
        choices: [
          { choice_name: 'Manufacture/Raw Material' }, { choice_name: 'Arc Spray' }, { choice_name: 'Cold Spray' },
          { choice_name: 'Welding' }, { choice_name: 'Chrome' }, { choice_name: 'HVOF' },
        ]
      },
      { id_parameter: '17', parameter_name: 'Consumable Insert', isnumber: false, ischoice: true, uom: '', parameter_no: 3,
        choices: [ { choice_name: 'BA101' }, { choice_name: 'BA402' }, { choice_name: 'BA207A' }, { choice_name: 'BA433A' } ]
      },
      { id_parameter: '20', parameter_name: 'Length Machining', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 4 },
      { id_parameter: '19', parameter_name: 'Dimension Before Machining', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 5 },
      { id_parameter: '35', parameter_name: 'Dimension After Machining', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 6 },
      { id_parameter: '26', parameter_name: 'RPM (Spindle Speed)', isnumber: true, ischoice: false, uom: 'Rpm', parameter_no: 7 },
      { id_parameter: '30', parameter_name: 'Feeding', isnumber: true, ischoice: false, uom: 'mm/rev', parameter_no: 8 },
      { id_parameter: '32', parameter_name: 'Depth of Cut', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 9 },
      { id_parameter: '33', parameter_name: 'Lubrication', isnumber: false, ischoice: true, uom: '', parameter_no: 10,
        choices: [ { choice_name: 'Coolant' }, { choice_name: 'Oil' }, { choice_name: 'Tap Matic' }, { choice_name: 'Dry' } ]
      },
      { id_parameter: '36', parameter_name: 'Condition Material After Machining', isnumber: false, ischoice: true, uom: '', parameter_no: 12,
        choices: [
          { choice_name: 'On Spec' }, { choice_name: 'Under Size' }, { choice_name: 'Over Size' },
          { choice_name: 'Oval' }, { choice_name: 'Tapper' }, { choice_name: 'Misalignment' },
          { choice_name: 'Bending' }, { choice_name: 'Crack' },
        ]
      },
      { id_parameter: '49', parameter_name: 'Operator Note', isnumber: false, ischoice: false, uom: '', parameter_no: 13 },
    ],
    // General Welding (id_process=4)
    '4': [
      { id_parameter: '34', parameter_name: 'Welding Process', isnumber: false, ischoice: true, uom: '', parameter_no: 1,
        choices: [ { choice_name: 'FCAW' }, { choice_name: 'GMAW' }, { choice_name: 'SMAW' }, { choice_name: 'GTAW' } ]
      },
      { id_parameter: '37', parameter_name: 'Filler Material', isnumber: false, ischoice: true, uom: '', parameter_no: 2,
        choices: [
          { choice_name: 'Hyundai E71T' }, { choice_name: 'HUATONG ER 70S-6' }, { choice_name: 'KISWEL ER308' },
          { choice_name: 'KISWEL ER309' }, { choice_name: 'KISWEL E71TLF' }, { choice_name: 'KISWEL E70MC' },
          { choice_name: 'REVOLLOY ER110S-G' }, { choice_name: 'BOHLER ER70S-6' }, { choice_name: 'ESAB ER309' },
        ]
      },
      { id_parameter: '38', parameter_name: 'Electrode Type', isnumber: false, ischoice: true, uom: '', parameter_no: 3,
        choices: [ { choice_name: 'FCAW' }, { choice_name: 'GMAW' }, { choice_name: 'SMAW' }, { choice_name: 'GTAW' } ]
      },
      { id_parameter: '39', parameter_name: 'Wire Diameter', isnumber: false, ischoice: true, uom: '', parameter_no: 4,
        choices: [ { choice_name: '1,0 mm' }, { choice_name: '1,2 mm' }, { choice_name: '1,6 mm' }, { choice_name: '2,4 mm' } ]
      },
      { id_parameter: '48', parameter_name: 'Material Thickness', isnumber: true, ischoice: false, uom: '', parameter_no: 6 },
      { id_parameter: '40', parameter_name: 'Position Welding', isnumber: false, ischoice: true, uom: '', parameter_no: 7,
        choices: [
          { choice_name: 'Build Up' }, { choice_name: 'Root' }, { choice_name: 'Fill' }, { choice_name: 'Cap' },
          { choice_name: '1G' }, { choice_name: '2G' }, { choice_name: '3G' }, { choice_name: '4G' },
          { choice_name: '1F' }, { choice_name: '2F' }, { choice_name: '3F' }, { choice_name: '4F' },
        ]
      },
      { id_parameter: '41', parameter_name: 'Pre heat', isnumber: true, ischoice: false, uom: 'deg C', parameter_no: 8 },
      { id_parameter: '42', parameter_name: 'Gas Flowrate', isnumber: true, ischoice: false, uom: 'lpm', parameter_no: 9 },
      { id_parameter: '43', parameter_name: 'Amperage', isnumber: true, ischoice: false, uom: 'A', parameter_no: 10 },
      { id_parameter: '44', parameter_name: 'Voltage', isnumber: true, ischoice: false, uom: 'V', parameter_no: 11 },
      { id_parameter: '45', parameter_name: 'Temperature After Welding', isnumber: true, ischoice: false, uom: 'deg C', parameter_no: 12 },
      { id_parameter: '46', parameter_name: 'Treatment After Welding', isnumber: false, ischoice: true, uom: '', parameter_no: 13,
        choices: [ { choice_name: 'PWHT' }, { choice_name: 'Peening' }, { choice_name: 'brushing' }, { choice_name: 'Grinding' }, { choice_name: 'Chipping' }, { choice_name: 'N/A' } ]
      },
      { id_parameter: '47', parameter_name: 'Operator Note', isnumber: false, ischoice: false, uom: '', parameter_no: 14 },
    ],
    // HCP - Prepolish (id_process=5)
    '5': [
      { id_parameter: '55', parameter_name: 'Lenght (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 1 },
      { id_parameter: '56', parameter_name: 'Top Spec (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 2 },
      { id_parameter: '57', parameter_name: 'Spec Dia (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 3 },
      { id_parameter: '58', parameter_name: 'Bottom Spec (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 4 },
      { id_parameter: '61', parameter_name: 'Condition', isnumber: false, ischoice: true, uom: '', parameter_no: 5,
        choices: [ { choice_name: 'After Build Up Welding' }, { choice_name: 'Normal/Rechrome' }, { choice_name: 'Pengulangan Proses' } ]
      },
      { id_parameter: '63', parameter_name: 'Hardness Before 1 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 11 },
      { id_parameter: '64', parameter_name: 'Hardness Before 2 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 12 },
      { id_parameter: '65', parameter_name: 'Hardness Before 3 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 13 },
      { id_parameter: '66', parameter_name: 'Hardness Before 4 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 14 },
      { id_parameter: '67', parameter_name: 'Hardness Before 5 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 15 },
      { id_parameter: '68', parameter_name: 'Start OD 1 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 16 },
      { id_parameter: '69', parameter_name: 'Start OD 2 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 17 },
      { id_parameter: '70', parameter_name: 'Start OD 3 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 18 },
      { id_parameter: '71', parameter_name: 'Start OD 4 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 19 },
      { id_parameter: '72', parameter_name: 'Start OD 5 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 20 },
      { id_parameter: '73', parameter_name: 'Start OD 6 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 21 },
      { id_parameter: '74', parameter_name: 'Start OD 7 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 22 },
      { id_parameter: '75', parameter_name: 'Start OD 8 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 23 },
      { id_parameter: '76', parameter_name: 'Start OD 9 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 24 },
      { id_parameter: '77', parameter_name: 'Start OD 10 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 25 },
      { id_parameter: '78', parameter_name: 'Prep OD 1 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 26 },
      { id_parameter: '79', parameter_name: 'Prep OD 2 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 27 },
      { id_parameter: '80', parameter_name: 'Prep OD 3 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 28 },
      { id_parameter: '81', parameter_name: 'Prep OD 4 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 29 },
      { id_parameter: '82', parameter_name: 'Prep OD 5 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 30 },
      { id_parameter: '83', parameter_name: 'Prep OD 6 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 31 },
      { id_parameter: '84', parameter_name: 'Prep OD 7 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 32 },
      { id_parameter: '85', parameter_name: 'Prep OD 8 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 33 },
      { id_parameter: '86', parameter_name: 'Prep OD 9 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 34 },
      { id_parameter: '87', parameter_name: 'Prep OD 10 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 35 },
      { id_parameter: '91', parameter_name: 'Dot Welds', isnumber: false, ischoice: true, uom: '', parameter_no: 36,
        choices: [ { choice_name: 'Yes' }, { choice_name: 'No' } ]
      },
      { id_parameter: '92', parameter_name: 'Tig Welds', isnumber: false, ischoice: true, uom: '', parameter_no: 37,
        choices: [ { choice_name: 'Yes' }, { choice_name: 'No' } ]
      },
      { id_parameter: '135', parameter_name: 'Note Prep', isnumber: false, ischoice: false, uom: '', parameter_no: 38 },
    ],
    // HCP - Plating (id_process=6)
    '6': [
      { id_parameter: '50', parameter_name: 'Plating Time (hours)', isnumber: true, ischoice: false, uom: 'Hours', parameter_no: 1 },
      { id_parameter: '51', parameter_name: 'Temperatur Plating (C)', isnumber: true, ischoice: false, uom: 'Celcius', parameter_no: 2 },
      { id_parameter: '52', parameter_name: 'Arus Plating (A)', isnumber: true, ischoice: false, uom: 'Ampere', parameter_no: 3 },
      { id_parameter: '134', parameter_name: 'Voltage (V)', isnumber: true, ischoice: false, uom: 'Volt', parameter_no: 4 },
      { id_parameter: '59', parameter_name: 'Number Tank', isnumber: false, ischoice: true, uom: '', parameter_no: 5,
        choices: [ { choice_name: '1' }, { choice_name: '2' }, { choice_name: '3' }, { choice_name: '4' }, { choice_name: '5' } ]
      },
      { id_parameter: '60', parameter_name: 'Jumlah Process Chrome (Kali)', isnumber: false, ischoice: true, uom: '', parameter_no: 6,
        choices: [ { choice_name: '1' }, { choice_name: '2' }, { choice_name: '3' }, { choice_name: '4' }, { choice_name: '5' } ]
      },
      { id_parameter: '54', parameter_name: 'Defect', isnumber: false, ischoice: true, uom: '', parameter_no: 7,
        choices: [
          { choice_name: 'Bubble' }, { choice_name: 'Hardness Underspec' }, { choice_name: 'No Defect' },
          { choice_name: 'Oval' }, { choice_name: 'Pitting' }, { choice_name: 'Roughness Underspec' },
          { choice_name: 'Undersize' }, { choice_name: 'Visual' },
        ]
      },
      { id_parameter: '53', parameter_name: 'Solving', isnumber: false, ischoice: true, uom: '', parameter_no: 8,
        choices: [ { choice_name: 'CoC' }, { choice_name: 'Dechrome' }, { choice_name: 'CoS' }, { choice_name: 'Prep CoC' } ]
      },
      { id_parameter: '136', parameter_name: 'Note Plating', isnumber: false, ischoice: false, uom: '', parameter_no: 9 },
    ],
    // HCP - Final Polish (id_process=7)
    '7': [
      { id_parameter: '93', parameter_name: 'Dot Welds', isnumber: false, ischoice: true, uom: '', parameter_no: 1,
        choices: [ { choice_name: 'Yes' }, { choice_name: 'No' } ]
      },
      { id_parameter: '94', parameter_name: 'Cold/After Platting OD 1 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 2 },
      { id_parameter: '95', parameter_name: 'Cold/After Platting OD 2 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 3 },
      { id_parameter: '96', parameter_name: 'Cold/After Platting OD 3 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 4 },
      { id_parameter: '97', parameter_name: 'Cold/After Platting OD 4 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 5 },
      { id_parameter: '98', parameter_name: 'Cold/After Platting OD 5 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 6 },
      { id_parameter: '99', parameter_name: 'Cold/After Platting OD 6 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 7 },
      { id_parameter: '100', parameter_name: 'Cold/After Platting OD 7 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 8 },
      { id_parameter: '101', parameter_name: 'Cold/After Platting OD 8 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 9 },
      { id_parameter: '102', parameter_name: 'Cold/After Platting OD 9 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 10 },
      { id_parameter: '103', parameter_name: 'Cold/After Platting OD 10 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 11 },
      { id_parameter: '104', parameter_name: 'Finish OD 1 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 12 },
      { id_parameter: '105', parameter_name: 'Finish OD 2 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 13 },
      { id_parameter: '106', parameter_name: 'Finish OD 3 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 14 },
      { id_parameter: '107', parameter_name: 'Finish OD 4 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 15 },
      { id_parameter: '108', parameter_name: 'Finish OD 5 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 16 },
      { id_parameter: '109', parameter_name: 'Finish OD 6 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 17 },
      { id_parameter: '110', parameter_name: 'Finish OD 7 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 18 },
      { id_parameter: '111', parameter_name: 'Finish OD 8 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 19 },
      { id_parameter: '112', parameter_name: 'Finish OD 9 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 20 },
      { id_parameter: '113', parameter_name: 'Finish OD 10 (mm)', isnumber: true, ischoice: false, uom: 'mm', parameter_no: 21 },
      { id_parameter: '114', parameter_name: 'Finish Hardness 1 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 22 },
      { id_parameter: '115', parameter_name: 'Finish Hardness 2 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 23 },
      { id_parameter: '116', parameter_name: 'Finish Hardness 3 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 24 },
      { id_parameter: '117', parameter_name: 'Finish Hardness 4 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 25 },
      { id_parameter: '118', parameter_name: 'Finish Hardness 5 (HRC)', isnumber: true, ischoice: false, uom: 'HRC', parameter_no: 26 },
      { id_parameter: '119', parameter_name: 'Finish Thickness 1 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 27 },
      { id_parameter: '120', parameter_name: 'Finish Thickness 2 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 28 },
      { id_parameter: '121', parameter_name: 'Finish Thickness 3 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 29 },
      { id_parameter: '122', parameter_name: 'Finish Thickness 4 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 30 },
      { id_parameter: '123', parameter_name: 'Finish Thickness 5 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 31 },
      { id_parameter: '124', parameter_name: 'Finish Roughness Ra 1 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 32 },
      { id_parameter: '125', parameter_name: 'Finish Roughness Ra 2 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 33 },
      { id_parameter: '126', parameter_name: 'Finish Roughness Ra 3 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 34 },
      { id_parameter: '127', parameter_name: 'Finish Roughness Ra 4 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 35 },
      { id_parameter: '128', parameter_name: 'Finish Roughness Ra 5 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 36 },
      { id_parameter: '129', parameter_name: 'Finish Roughness Rz 1 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 37 },
      { id_parameter: '130', parameter_name: 'Finish Roughness Rz 2 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 38 },
      { id_parameter: '131', parameter_name: 'Finish Roughness Rz 3 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 39 },
      { id_parameter: '132', parameter_name: 'Finish Roughness Rz 4 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 40 },
      { id_parameter: '133', parameter_name: 'Finish Roughness Rz 5 (Micro)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 41 },
      { id_parameter: '137', parameter_name: 'Note Finish', isnumber: false, ischoice: false, uom: '', parameter_no: 42 },
    ],
    // HCP - Stripping (id_process=8)
    '8': [
      { id_parameter: '90', parameter_name: 'Time (Hour)', isnumber: true, ischoice: false, uom: 'Hour', parameter_no: 1 },
      { id_parameter: '88', parameter_name: 'Voltage (V)', isnumber: true, ischoice: false, uom: 'Volt', parameter_no: 2 },
      { id_parameter: '89', parameter_name: 'Amperage (A)', isnumber: true, ischoice: false, uom: 'Ampere', parameter_no: 3 },
      { id_parameter: '139', parameter_name: 'Thickness Before 1 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 4 },
      { id_parameter: '140', parameter_name: 'Thickness Before 2 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 5 },
      { id_parameter: '141', parameter_name: 'Thickness Before 3 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 6 },
      { id_parameter: '142', parameter_name: 'Thickness Before 4 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 7 },
      { id_parameter: '143', parameter_name: 'Thickness Before 5 (Micron)', isnumber: true, ischoice: false, uom: 'Micron', parameter_no: 8 },
      { id_parameter: '138', parameter_name: 'Note Stripping', isnumber: false, ischoice: false, uom: '', parameter_no: 9 },
    ],
    // Arc Spray (id_process=9)
    '9': [
      { id_parameter: '145', parameter_name: 'Part Name', isnumber: false, ischoice: false, uom: '', parameter_no: 1 },
      { id_parameter: '146', parameter_name: 'Model', isnumber: true, ischoice: false, uom: '', parameter_no: 2 },
      { id_parameter: '147', parameter_name: 'Condition', isnumber: false, ischoice: true, uom: '', parameter_no: 3,
        choices: [ { choice_name: 'New' }, { choice_name: 'Rework' } ]
      },
      { id_parameter: '148', parameter_name: 'Coating', isnumber: false, ischoice: true, uom: '', parameter_no: 4,
        choices: [ { choice_name: 'Bond' }, { choice_name: 'Bond & Top' } ]
      },
      { id_parameter: '149', parameter_name: 'Surface Area', isnumber: false, ischoice: true, uom: '', parameter_no: 5,
        choices: [ { choice_name: 'Flat (Non Rotating)' }, { choice_name: 'Round (Rotating)' } ]
      },
      { id_parameter: '150', parameter_name: 'Rougness Blasting/Ra', isnumber: true, ischoice: false, uom: '', parameter_no: 6 },
      { id_parameter: '151', parameter_name: 'Spec Diameter (Round)/Panjang (Flat)', isnumber: true, ischoice: false, uom: '', parameter_no: 7 },
      { id_parameter: '152', parameter_name: 'Spec Lenght (Round) / Lebar (Flat)', isnumber: true, ischoice: false, uom: '', parameter_no: 8 },
      { id_parameter: '153', parameter_name: 'Area Repair', isnumber: false, ischoice: true, uom: '', parameter_no: 9,
        choices: [
          { choice_name: 'ID Seal Contact' }, { choice_name: 'OD Seal Contact' }, { choice_name: 'Metal Contact' },
          { choice_name: 'Gasket Contact' }, { choice_name: 'ID Bearing Contact' }, { choice_name: 'OD Bearing Contact' },
          { choice_name: 'Retainer Contact' }, { choice_name: 'Engine block' },
        ]
      },
      { id_parameter: '154', parameter_name: 'Diameter After Blast', isnumber: true, ischoice: false, uom: '', parameter_no: 10 },
      { id_parameter: '155', parameter_name: 'Diameter After Bond', isnumber: true, ischoice: false, uom: '', parameter_no: 11 },
      { id_parameter: '156', parameter_name: 'Diameter After Top', isnumber: true, ischoice: false, uom: '', parameter_no: 12 },
      { id_parameter: '157', parameter_name: 'Material Bond Coat', isnumber: false, ischoice: true, uom: '', parameter_no: 13,
        choices: [ { choice_name: 'AS175' }, { choice_name: 'DM955' }, { choice_name: 'PMET885' }, { choice_name: 'TAFA75B' } ]
      },
      { id_parameter: '158', parameter_name: 'Wire 1 Lot # Bond Coat', isnumber: false, ischoice: false, uom: '', parameter_no: 14 },
      { id_parameter: '159', parameter_name: 'Wire 2 Lot # Bond Coat', isnumber: false, ischoice: false, uom: '', parameter_no: 15 },
      { id_parameter: '160', parameter_name: 'Primary Air Pressure (Psi) Bond Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 16 },
      { id_parameter: '161', parameter_name: 'Arc Voltage (V) Bond Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 17 },
      { id_parameter: '162', parameter_name: 'Arc Current (Amps) Bond Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 18 },
      { id_parameter: '163', parameter_name: 'Rotation Speed of Part (rpm) Bond Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 19 },
      { id_parameter: '164', parameter_name: 'Traverse Rate of Gun (mm/s) Bond Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 20 },
      { id_parameter: '165', parameter_name: 'Bondcoat Robot cycle (Pass)', isnumber: true, ischoice: false, uom: '', parameter_no: 21 },
      { id_parameter: '166', parameter_name: 'Material Top Coat', isnumber: false, ischoice: true, uom: '', parameter_no: 22,
        choices: [ { choice_name: 'AS130' }, { choice_name: 'PMET709' }, { choice_name: 'AS160' }, { choice_name: 'DM420' }, { choice_name: 'PMET297' } ]
      },
      { id_parameter: '167', parameter_name: 'Wire 1 Lot # Top Coat', isnumber: false, ischoice: false, uom: '', parameter_no: 23 },
      { id_parameter: '168', parameter_name: 'Wire 2 Lot # Top Coat', isnumber: false, ischoice: false, uom: '', parameter_no: 24 },
      { id_parameter: '169', parameter_name: 'Primary Air Pressure (Psi) Top Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 25 },
      { id_parameter: '170', parameter_name: 'Arc Voltage (V) Top Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 26 },
      { id_parameter: '171', parameter_name: 'Arc Current (Amps) Top Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 27 },
      { id_parameter: '172', parameter_name: 'Rotation Speed of Part (rpm) Top Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 28 },
      { id_parameter: '173', parameter_name: 'Traverse Rate of Gun (mm/s) Top Coat', isnumber: true, ischoice: false, uom: '', parameter_no: 29 },
      { id_parameter: '174', parameter_name: 'Top coat Robot cycle (Pass)', isnumber: true, ischoice: false, uom: '', parameter_no: 30 },
      { id_parameter: '175', parameter_name: 'Dictol', isnumber: false, ischoice: true, uom: '', parameter_no: 31,
        choices: [ { choice_name: 'Used' }, { choice_name: 'Not Used' } ]
      },
    ],
  };

  // ====== END DUMMY DATA ======

  useEffect(() => {
    loadCategories();
    loadTimesheets();
  }, []);

  const loadCategories = async () => {
    /* PRODUCTION CODE
    try {
      const res = await fetch('/process-category');
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
    */
    setCategories(dummyCategories);
  };

  const loadTimesheets = async () => {
    /* PRODUCTION CODE
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      const serialnumber = datakaryawan?.snssb;
      if (!serialnumber) return;
      const res = await fetch(`/timesheet/getsn/${serialnumber}`);
      const data = await res.json();
      setTimesheets(data);
    } catch (err) {
      console.error('Error loading timesheets:', err);
    }
    */
    setTimesheets(dummyTimesheets);
  };

  const loadParameters = async (categoryId) => {
    setLoading(true);
    /* PRODUCTION CODE
    try {
      const res = await fetch(`/process-parameter?process=${categoryId}`);
      const data = await res.json();
      for (const param of data) {
        if (param.ischoice) {
          const chRes = await fetch(`/process-parameter-choicebase?parameter=${param.id_parameter}`);
          param.choices = await chRes.json();
        }
      }
      setParameters(data);
      setStep(3);
    } catch (err) {
      console.error('Error loading parameters:', err);
      alert('Gagal load parameters');
    } finally {
      setLoading(false);
    }
    */
    setTimeout(() => {
      const params = dummyParametersMap[categoryId] || [];
      setParameters(params.sort((a, b) => a.parameter_no - b.parameter_no));
      setStep(3);
      setLoading(false);
    }, 300);
  };

  const handleCategorySelect = (categoryId) => {
    setSelectedCategory(categoryId);
    setStep(2);
  };

  const handleTimesheetSelect = (timesheet) => {
    setSelectedTimesheet(timesheet);
    loadParameters(selectedCategory);
  };

  const handleInputChange = (parameterId, value) => {
    setFormData(prev => ({ ...prev, [parameterId]: value }));
  };

  const handleSubmit = async () => {
    const emptyRequired = parameters.filter(p => {
      if (p.parameter_name.toLowerCase().includes('note')) return false; // notes optional
      return !formData[p.id_parameter];
    });
    if (emptyRequired.length > 0) {
      alert(`Mohon isi parameter: ${emptyRequired.map(p => p.parameter_name).join(', ')}`);
      return;
    }
    if (!selectedTimesheet) {
      alert('Pilih timesheet terlebih dahulu');
      return;
    }

    setLoading(true);
    /* PRODUCTION CODE
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      const controlRes = await fetch('/process-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          production_order: selectedTimesheet.production_order,
          ssbr_id: selectedTimesheet.ssbr_ident,
          operation_text: selectedTimesheet.operation_text,
          full_name: datakaryawan.full_name,
          snssb: datakaryawan.snssb,
          operation_no: selectedTimesheet.seq,
          workcenter: selectedTimesheet.workcentercode
        })
      });
      const controlData = await controlRes.json();
      const newId = controlData.id_processcontroldata;
      for (const param of parameters) {
        const value = formData[param.id_parameter];
        await fetch('/process-control-item', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category_name: categories.find(c => c.id_process === selectedCategory)?.process_name,
            parameter_name: param.parameter_name,
            value,
            uom: param.uom || '',
            isnumber: param.isnumber,
            ischoice: param.ischoice,
            id_parameter: param.id_parameter,
            id_processcontroldata: newId
          })
        });
      }
      alert('Data process control berhasil disimpan!');
      navigate('/timesheet-mainmenu');
    } catch (err) {
      console.error('Error saving process control:', err);
      alert('Gagal menyimpan data');
    } finally {
      setLoading(false);
    }
    */
    setTimeout(() => {
      console.log('Process Control Data:', { category: selectedCategory, timesheet: selectedTimesheet, parameters: formData });
      alert('Data process control berhasil disimpan! (DUMMY MODE)');
      setLoading(false);
      navigate('/timesheet-mainmenu');
    }, 600);
  };

  const handleReset = () => {
    setSelectedCategory('');
    setSelectedTimesheet(null);
    setParameters([]);
    setFormData({});
    setStep(1);
  };

  const goBack = () => {
    navigate('/timesheet-mainmenu');
  };

  // ====== RENDER HELPERS ======

  // Group parameters into sections by detecting patterns (OD 1-10, Hardness 1-5, etc.)
  const groupParameters = (params) => {
    const groups = [];
    let currentGroup = { label: null, params: [] };

    params.forEach((param) => {
      // Detect note fields — always standalone
      if (param.parameter_name.toLowerCase().includes('note')) {
        if (currentGroup.params.length > 0) {
          groups.push({ ...currentGroup });
          currentGroup = { label: null, params: [] };
        }
        groups.push({ label: null, params: [param], isNote: true });
        return;
      }
      currentGroup.params.push(param);
    });

    if (currentGroup.params.length > 0) {
      groups.push(currentGroup);
    }
    return groups;
  };

  // Render single parameter input — compact inline style
  const renderParamInput = (param) => {
    const val = formData[param.id_parameter] || '';
    const isNote = param.parameter_name.toLowerCase().includes('note');

    if (param.ischoice) {
      return (
        <select
          value={val}
          onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">-- Pilih --</option>
          {param.choices?.map((c, i) => (
            <option key={i} value={c.choice_name}>{c.choice_name}</option>
          ))}
        </select>
      );
    }

    if (param.isnumber) {
      return (
        <input
          type="number"
          value={val}
          onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
          className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          step="any"
          placeholder="0"
        />
      );
    }

    // Text / Note
    if (isNote) {
      return (
        <textarea
          value={val}
          onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
          placeholder="Catatan..."
        />
      );
    }

    return (
      <input
        type="text"
        value={val}
        onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-white border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        placeholder="-"
      />
    );
  };

  // Category icon map
  const categoryIcon = {
    '1': '🔥', '2': '⚡', '3': '⚙️', '4': '🔧',
    '5': '💎', '6': '🧪', '7': '✨', '8': '🧹', '9': '🌀',
  };

  const selectedCategoryName = categories.find(c => c.id_process === selectedCategory)?.process_name || '';

  return (
    <div className="h-screen w-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2 shadow-md flex-shrink-0">
        <button onClick={goBack} className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors">
          Back
        </button>
        <h2 className="text-sm sm:text-base font-bold text-white">Process Control</h2>
        <button onClick={handleReset} className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors">
          Reset
        </button>
      </header>

      {/* Progress Steps — compact */}
      <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex-shrink-0">
        <div className="flex items-center justify-center gap-1.5">
          {[
            { n: 1, label: 'Category' },
            { n: 2, label: 'Timesheet' },
            { n: 3, label: 'Parameters' },
          ].map((s, i) => (
            <React.Fragment key={s.n}>
              {i > 0 && <span className="text-blue-400 text-xs">›</span>}
              <button
                onClick={() => {
                  if (s.n < step) setStep(s.n);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  step === s.n
                    ? 'bg-blue-600 text-white shadow-sm'
                    : step > s.n
                    ? 'bg-blue-200 text-blue-800 hover:bg-blue-300 cursor-pointer'
                    : 'bg-white text-gray-400 border border-gray-200'
                }`}
                disabled={s.n > step}
              >
                <span className="font-bold">{s.n}</span>
                <span>{s.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-3 py-3">
        <div className="max-w-6xl mx-auto">

          {/* ============ STEP 1: Select Category ============ */}
          {step === 1 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-blue-900">Pilih Kategori Proses</h3>
                <button
                  onClick={() => navigate('/edit-parameter')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 transition-colors shadow-sm"
                >
                  <span>📝</span>
                  <span>Edit Parameter</span>
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {categories.map(cat => (
                  <button
                    key={cat.id_process}
                    onClick={() => handleCategorySelect(cat.id_process)}
                    className="p-3 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-all text-left group"
                  >
                    <div className="text-lg mb-1">{categoryIcon[cat.id_process] || '📋'}</div>
                    <div className="text-xs font-bold text-blue-900 group-hover:text-blue-700 leading-tight">
                      {cat.process_name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ============ STEP 2: Select Timesheet ============ */}
          {step === 2 && (
            <div>
              <h3 className="text-sm font-bold text-blue-900 mb-3">Pilih Timesheet Aktif</h3>
              {timesheets.length === 0 ? (
                <div className="text-center text-gray-500 py-8 text-sm">Tidak ada timesheet aktif</div>
              ) : (
                <div className="space-y-2">
                  {timesheets.map((ts, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleTimesheetSelect(ts)}
                      className="p-3 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-blue-900">{ts.production_order}</span>
                        <span className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                          {ts.workcenterdescription || ts.workcentercode}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-600">
                        <div><span className="text-gray-400">SSBR:</span> {ts.ssbr_ident}</div>
                        <div><span className="text-gray-400">Seq:</span> {ts.seq}</div>
                        <div><span className="text-gray-400">By:</span> {ts.full_name}</div>
                      </div>
                      <div className="text-[11px] text-gray-700 mt-1 truncate">
                        <span className="text-gray-400">Op:</span> {ts.operation_text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============ STEP 3: Fill Parameters — 3 Column Layout ============ */}
          {step === 3 && (
            <div>
              {/* Info bar */}
              <div className="flex items-center gap-2 mb-3 p-2 bg-blue-600 text-white rounded-lg text-xs">
                <span className="text-base">{categoryIcon[selectedCategory]}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold">{selectedCategoryName}</div>
                  <div className="text-blue-200 text-[10px] truncate">
                    {selectedTimesheet?.production_order} — {selectedTimesheet?.operation_text}
                  </div>
                </div>
                <span className="text-[10px] bg-blue-500 px-2 py-0.5 rounded">
                  {parameters.length} params
                </span>
              </div>

              {/* Parameters Grid — 3 columns, note fields span full width */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {parameters.map(param => {
                  const isNote = param.parameter_name.toLowerCase().includes('note');
                  return (
                    <div
                      key={param.id_parameter}
                      className={`bg-white border border-gray-200 rounded-lg p-2 ${
                        isNote ? 'sm:col-span-2 lg:col-span-3' : ''
                      }`}
                    >
                      <label className="flex items-baseline gap-1 mb-1">
                        <span className="text-[11px] font-semibold text-gray-800 leading-tight">
                          {param.parameter_name}
                        </span>
                        {param.uom && (
                          <span className="text-[10px] text-blue-500 whitespace-nowrap">
                            ({param.uom})
                          </span>
                        )}
                      </label>
                      {renderParamInput(param)}
                    </div>
                  );
                })}
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className={`w-full mt-4 py-2.5 text-sm font-bold text-white rounded-lg transition-colors ${
                  loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700'
                }`}
              >
                {loading ? 'Menyimpan...' : 'Submit Process Control'}
              </button>
            </div>
          )}

          {/* Loading overlay */}
          {loading && step !== 3 && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProcessControlPage;
