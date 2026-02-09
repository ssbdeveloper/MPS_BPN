import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Select Machine Page
 * Converted dari menuworkcenter.html
 * Color scheme: White 65%, Blue 25% (90% opacity), Orange 10% (CTA)
 */
const API_BASE = import.meta.env.VITE_API_URL || '';

const SelectMachinePage = () => {
  const navigate = useNavigate();

  // States
  const [wcMode, setWcMode] = useState(() => sessionStorage.getItem('wcMode') || 'reguler');
  const [searchInput, setSearchInput] = useState('');
  const [machines, setMachines] = useState([]);
  const [filteredMachines, setFilteredMachines] = useState([]);

  // Load machines on mount
  useEffect(() => {
    loadMachines();
  }, []);

  // Filter machines when search changes
  useEffect(() => {
    if (!searchInput.trim()) {
      setFilteredMachines(machines);
      return;
    }

    const keyword = searchInput.toLowerCase();
    const filtered = machines.filter(item =>
      item.workcenter_description?.toLowerCase().includes(keyword) ||
      item.machineid?.toLowerCase().includes(keyword) ||
      item.groupname?.toLowerCase().includes(keyword)
    );
    setFilteredMachines(filtered);
  }, [searchInput, machines]);

  // API: Load machines
  const loadMachines = async () => {
    try {
      const res = await fetch(`${API_BASE}/workcenter/`);
      if (!res.ok) throw new Error('Gagal load mesin');
      const data = await res.json();

      if (data && data.length > 0) {
        setMachines(data);
        setFilteredMachines(data);
      } else {
        setMachines([]);
        setFilteredMachines([]);
      }
    } catch (err) {
      console.error('Error loading machines:', err);
      setMachines([]);
      setFilteredMachines([]);
    }
  };

  // Handle mode toggle
  const handleModeToggle = (checked) => {
    const newMode = checked ? 'overtime' : 'reguler';
    setWcMode(newMode);
    sessionStorage.setItem('wcMode', newMode);
  };

  // Handle machine selection
  const handleSelectMachine = async (machine) => {
    try {
      const datakaryawan = JSON.parse(sessionStorage.getItem('datakaryawan'));
      if (!datakaryawan) {
        alert('Data karyawan tidak ditemukan. Silakan login kembali.');
        navigate('/login-timesheet');
        return;
      }

      const nfcid = datakaryawan.nfcid;
      const selectedWorkcenter = wcMode === 'overtime'
        ? machine.workcenterot
        : machine.workcenternew;

      // Check if OT mode but no OT workcenter
      if (wcMode === 'overtime' && !machine.workcenterot) {
        alert('Workcenter Overtime tidak tersedia');
        return;
      }

      // Update user's machine selection
      const response = await fetch(`${API_BASE}/usernfc/update/`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialnumber: datakaryawan.snssb,
          machineid: machine.machineid,
          machinename: machine.workcenter_description,
          workcenter: selectedWorkcenter
        })
      });

      if (!response.ok) {
        throw new Error('Gagal update mesin');
      }

      // Reload updated user data
      const res = await fetch(`${API_BASE}/usernfc/nfcid/${nfcid}`);
      if (res.ok) {
        const updatedUser = await res.json();
        sessionStorage.setItem('datakaryawan', JSON.stringify(updatedUser));
      }

      // Navigate back to main menu
      navigate('/timesheet-mainmenu');

    } catch (err) {
      console.error('Error selecting machine:', err);
      alert('Update mesin gagal: ' + err.message);
    }
  };

  // Back to main menu
  const goBack = () => {
    navigate('/timesheet-mainmenu');
  };

  const isOT = wcMode === 'overtime';

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
      {/* Header - Dark Blue */}
      <header className="bg-blue-900 px-3 py-2.5 shadow-md flex-shrink-0">
        <div className="flex justify-between items-center">
          <button
            onClick={goBack}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Back
          </button>

          <h2 className="text-base sm:text-lg font-bold text-white">Select Machine</h2>

          <button
            onClick={loadMachines}
            className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Search + Mode Toggle - Light Blue */}
      <div className="bg-blue-50 border-b border-blue-200 px-3 py-2.5 flex-shrink-0 space-y-2">
        {/* Search */}
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search machine, ID, or group..."
            className="w-full pl-9 pr-3 py-2 text-sm text-gray-800 bg-white border-2 border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
        </div>

        {/* Mode Toggle Row */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-blue-700 font-medium">
            {filteredMachines.length} machine{filteredMachines.length !== 1 ? 's' : ''} found
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold transition-colors ${isOT ? 'text-blue-400' : 'text-blue-800'}`}>
              Reguler
            </span>
            <label className="relative inline-block w-11 h-6 cursor-pointer">
              <input
                type="checkbox"
                checked={isOT}
                onChange={(e) => handleModeToggle(e.target.checked)}
                className="hidden"
              />
              <span
                className={`
                  absolute inset-0 rounded-full transition-colors duration-300
                  ${isOT ? 'bg-orange-500' : 'bg-blue-600'}
                  before:content-[''] before:absolute before:h-5 before:w-5
                  before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full
                  before:transition-transform before:duration-300 before:shadow-sm
                  ${isOT ? 'before:translate-x-5' : 'before:translate-x-0'}
                `}
              />
            </label>
            <span className={`text-xs font-bold transition-colors ${isOT ? 'text-orange-600' : 'text-blue-400'}`}>
              Overtime
            </span>
          </div>
        </div>
      </div>

      {/* Machine Grid - Scrollable */}
      <div className="flex-1 overflow-y-auto p-3 bg-white">
        {filteredMachines.length === 0 ? (
          <div className="text-center text-gray-500 mt-10">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto mb-3 text-blue-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p className="text-sm font-medium">Tidak ada mesin ditemukan</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredMachines.map((machine, index) => {
              const workcenterText = isOT
                ? machine.workcenterot
                : machine.workcenternew;

              return (
                <div
                  key={index}
                  onClick={() => handleSelectMachine(machine)}
                  className={`
                    relative rounded-lg overflow-hidden cursor-pointer
                    transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0
                    ${isOT
                      ? 'border-2 border-orange-300 bg-white shadow-md hover:border-orange-400'
                      : 'border-2 border-blue-200 bg-white shadow-md hover:border-blue-400'
                    }
                  `}
                >
                  {/* Card Header Bar */}
                  <div className={`px-4 py-2 ${isOT ? 'bg-orange-50' : 'bg-blue-50'}`}>
                    <div className="flex items-center justify-between">
                      <div className={`text-sm font-bold truncate pr-2 ${isOT ? 'text-orange-900' : 'text-blue-900'}`}>
                        {machine.workcenter_description}
                      </div>
                      {isOT && (
                        <span className="flex-shrink-0 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                          OT
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="px-4 py-3 space-y-1.5">
                    <div className="flex text-[11px]">
                      <span className={`w-[70px] flex-shrink-0 font-medium ${isOT ? 'text-orange-600' : 'text-blue-600'}`}>ID</span>
                      <span className="font-semibold text-gray-800">: {machine.machineid}</span>
                    </div>
                    <div className="flex text-[11px]">
                      <span className={`w-[70px] flex-shrink-0 font-medium ${isOT ? 'text-orange-600' : 'text-blue-600'}`}>Group</span>
                      <span className="font-semibold text-gray-800">: {machine.groupname}</span>
                    </div>
                    <div className="flex text-[11px]">
                      <span className={`w-[70px] flex-shrink-0 font-medium ${isOT ? 'text-orange-600' : 'text-blue-600'}`}>WC Code</span>
                      <span className="font-bold text-gray-900">: {workcenterText || '-'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SelectMachinePage;
