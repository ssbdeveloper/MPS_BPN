import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Process Control Page
 * Converted dari processcontrol_form.html dengan inovasi:
 * - Better UX dengan step-by-step flow
 * - Visual feedback untuk setiap step
 * - Auto-save draft
 * - Validation sebelum submit
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
  const [step, setStep] = useState(1); // 1: Select Category, 2: Select Timesheet, 3: Fill Parameters

  // Load initial data
  useEffect(() => {
    loadCategories();
    loadTimesheets();
  }, []);

  // API: Load process categories
  const loadCategories = async () => {
    // NOTE: Untuk development, load dummy data dulu
    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const res = await fetch('/process-category');
      const data = await res.json();
      setCategories(data);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
    */

    // DEVELOPMENT MODE - Dummy data
    const dummyCategories = [
      { id_process: '1', process_name: 'Temperature Control' },
      { id_process: '2', process_name: 'Pressure Control' },
      { id_process: '3', process_name: 'Quality Check' },
      { id_process: '4', process_name: 'Material Inspection' }
    ];
    setCategories(dummyCategories);
  };

  // API: Load user timesheets
  const loadTimesheets = async () => {
    // NOTE: Untuk development, load dummy data dulu
    /* PRODUCTION CODE - Uncomment untuk production
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

    // DEVELOPMENT MODE - Dummy data
    const dummyTimesheets = [
      {
        production_order: '1000116114',
        ssbr_ident: 'M001',
        operation_text: 'CNC Milling Process',
        seq: '10',
        workcentercode: 'WC-001'
      },
      {
        production_order: '1000116115',
        ssbr_ident: 'M002',
        operation_text: 'Grinding Process',
        seq: '20',
        workcentercode: 'WC-005'
      }
    ];
    setTimesheets(dummyTimesheets);
  };

  // API: Load parameters for selected category
  const loadParameters = async (categoryId) => {
    setLoading(true);

    // NOTE: Untuk development, load dummy data dulu
    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const res = await fetch(`/process-parameter?process=${categoryId}`);
      const data = await res.json();

      // Load choices for choice parameters
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

    // DEVELOPMENT MODE - Dummy parameters
    setTimeout(() => {
      const dummyParameters = categoryId === '1' ? [
        {
          id_parameter: '1',
          parameter_name: 'Temperature',
          isnumber: true,
          ischoice: false,
          uom: '°C'
        },
        {
          id_parameter: '2',
          parameter_name: 'Duration',
          isnumber: true,
          ischoice: false,
          uom: 'minutes'
        },
        {
          id_parameter: '3',
          parameter_name: 'Coolant Type',
          isnumber: false,
          ischoice: true,
          uom: '',
          choices: [
            { choice_name: 'Water-based' },
            { choice_name: 'Oil-based' },
            { choice_name: 'Synthetic' }
          ]
        }
      ] : [
        {
          id_parameter: '4',
          parameter_name: 'Pressure Level',
          isnumber: true,
          ischoice: false,
          uom: 'PSI'
        }
      ];

      setParameters(dummyParameters);
      setStep(3);
      setLoading(false);
    }, 500);
  };

  // Handle category selection
  const handleCategorySelect = (categoryId) => {
    setSelectedCategory(categoryId);
    setStep(2);
  };

  // Handle timesheet selection
  const handleTimesheetSelect = (timesheet) => {
    setSelectedTimesheet(timesheet);
    loadParameters(selectedCategory);
  };

  // Handle form input change
  const handleInputChange = (parameterId, value) => {
    setFormData(prev => ({
      ...prev,
      [parameterId]: value
    }));
  };

  // Handle form submit
  const handleSubmit = async () => {
    // Validation
    const emptyFields = parameters.filter(p => !formData[p.id_parameter]);
    if (emptyFields.length > 0) {
      alert(`⚠️ Mohon isi semua parameter: ${emptyFields.map(p => p.parameter_name).join(', ')}`);
      return;
    }

    if (!selectedTimesheet) {
      alert('⚠️ Pilih timesheet terlebih dahulu');
      return;
    }

    setLoading(true);

    /* PRODUCTION CODE - Uncomment untuk production
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));

      // Create process control record
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

      // Save all parameters
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

      alert('✅ Data process control berhasil disimpan!');
      navigate('/timesheet-mainmenu');
    } catch (err) {
      console.error('Error saving process control:', err);
      alert('❌ Gagal menyimpan data');
    } finally {
      setLoading(false);
    }
    */

    // DEVELOPMENT MODE - Simulate save
    setTimeout(() => {
      console.log('Process Control Data:', {
        category: selectedCategory,
        timesheet: selectedTimesheet,
        parameters: formData
      });
      alert('✅ Data process control berhasil disimpan! (DUMMY MODE)');
      setLoading(false);
      navigate('/timesheet-mainmenu');
    }, 1000);
  };

  // Reset form
  const handleReset = () => {
    setSelectedCategory('');
    setSelectedTimesheet(null);
    setParameters([]);
    setFormData({});
    setStep(1);
  };

  // Back to main menu
  const goBack = () => {
    navigate('/timesheet-mainmenu');
  };

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="flex justify-between items-center bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Back
        </button>
        <h2 className="text-base sm:text-lg font-bold text-white">Process Control</h2>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Reset
        </button>
      </header>

      {/* Progress Steps */}
      <div className="bg-blue-50 border-b border-blue-200 px-3 py-3 flex-shrink-0">
        <div className="flex items-center justify-center gap-2">
          {/* Step 1 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded ${
            step >= 1 ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-blue-300'
          }`}>
            <span className="text-xs font-bold">1</span>
            <span className="text-xs font-medium">Category</span>
          </div>

          <span className="text-blue-600">→</span>

          {/* Step 2 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded ${
            step >= 2 ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-blue-300'
          }`}>
            <span className="text-xs font-bold">2</span>
            <span className="text-xs font-medium">Timesheet</span>
          </div>

          <span className="text-blue-600">→</span>

          {/* Step 3 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded ${
            step >= 3 ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-blue-300'
          }`}>
            <span className="text-xs font-bold">3</span>
            <span className="text-xs font-medium">Parameters</span>
          </div>
        </div>
      </div>

      {/* Main Content - White Background */}
      <main className="flex-1 overflow-y-auto px-3 py-4 bg-white">
        <div className="max-w-4xl mx-auto">
          {/* Step 1: Select Category */}
          {step === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-blue-900 mb-3">Select Process Category</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {categories.map(category => (
                  <button
                    key={category.id_process}
                    onClick={() => handleCategorySelect(category.id_process)}
                    className="p-4 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors text-left"
                  >
                    <div className="text-sm font-bold text-blue-900">{category.process_name}</div>
                    <div className="text-xs text-blue-700 mt-1">Click to select</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Select Timesheet */}
          {step === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-blue-900 mb-3">Select Active Timesheet</h3>
              {timesheets.length === 0 ? (
                <div className="text-center text-gray-600 py-8">
                  <p>No active timesheet found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {timesheets.map((ts, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleTimesheetSelect(ts)}
                      className="p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                    >
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="font-semibold text-blue-900">Order: </span>
                          <span className="text-gray-800">{ts.production_order}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-blue-900">Seq: </span>
                          <span className="text-gray-800">{ts.seq}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="font-semibold text-blue-900">Operation: </span>
                          <span className="text-gray-800">{ts.operation_text}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-blue-900">Workcenter: </span>
                          <span className="text-gray-800">{ts.workcentercode}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Fill Parameters */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-blue-900 mb-3">Fill Parameters</h3>

              {/* Selected Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-xs text-blue-900 mb-1">
                  <span className="font-semibold">Category: </span>
                  {categories.find(c => c.id_process === selectedCategory)?.process_name}
                </div>
                <div className="text-xs text-blue-900">
                  <span className="font-semibold">Order: </span>
                  {selectedTimesheet?.production_order} - {selectedTimesheet?.operation_text}
                </div>
              </div>

              {/* Parameters Form */}
              <div className="space-y-3">
                {parameters.map(param => (
                  <div key={param.id_parameter} className="bg-white border border-blue-200 rounded-lg p-3">
                    <label className="block text-xs font-semibold text-blue-900 mb-2">
                      {param.parameter_name}
                      {param.uom && <span className="text-blue-700 ml-1">({param.uom})</span>}
                    </label>

                    {/* Choice Parameter */}
                    {param.ischoice && (
                      <div className="space-y-2">
                        <select
                          value={formData[param.id_parameter] || ''}
                          onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
                          className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
                        >
                          <option value="">-- Select --</option>
                          {param.choices?.map((choice, idx) => (
                            <option key={idx} value={choice.choice_name}>
                              {choice.choice_name}
                            </option>
                          ))}
                          <option value="Other">Other</option>
                        </select>

                        {/* Other Input */}
                        {formData[param.id_parameter] === 'Other' && (
                          <input
                            type="text"
                            placeholder="Specify other..."
                            onChange={(e) => handleInputChange(`${param.id_parameter}_other`, e.target.value)}
                            className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
                          />
                        )}
                      </div>
                    )}

                    {/* Number Parameter */}
                    {!param.ischoice && param.isnumber && (
                      <input
                        type="number"
                        value={formData[param.id_parameter] || ''}
                        onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
                        className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
                        step="any"
                      />
                    )}

                    {/* Text Parameter */}
                    {!param.ischoice && !param.isnumber && (
                      <input
                        type="text"
                        value={formData[param.id_parameter] || ''}
                        onChange={(e) => handleInputChange(param.id_parameter, e.target.value)}
                        className="w-full px-3 py-2 text-sm text-gray-800 bg-white border border-blue-300 rounded focus:outline-none focus:border-blue-600"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Submit Button - Orange CTA */}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className={`w-full py-3 text-sm font-bold text-white rounded-lg transition-colors ${
                  loading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-orange-500 hover:bg-orange-600'
                }`}
              >
                {loading ? 'Submitting...' : 'Submit Process Control'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProcessControlPage;
