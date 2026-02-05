import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Select Machine Page
 * Converted dari menuworkcenter.html
 */
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
      const res = await fetch('/workcenter/');
      if (!res.ok) {
        throw new Error('Gagal load mesin dari API');
      }
      const data = await res.json();

      if (data && data.length > 0) {
        setMachines(data);
        setFilteredMachines(data);
      } else {
        throw new Error('Data kosong dari API');
      }
    } catch (err) {
      console.error('Error loading machines from API:', err);

      // Fallback to dummy data
      try {
        console.log('Loading dummy machines data...');
        const dummyResponse = await fetch('/dummy-machines.json');
        if (dummyResponse.ok) {
          const dummyData = await dummyResponse.json();
          setMachines(dummyData);
          setFilteredMachines(dummyData);
          alert('⚠️ Menggunakan data dummy (API tidak tersedia)');
        } else {
          throw new Error('Dummy data tidak tersedia');
        }
      } catch (dummyError) {
        console.error('Error loading dummy data:', dummyError);
        alert('❌ Gagal load data dari API dan dummy file');
        setMachines([]);
        setFilteredMachines([]);
      }
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
      const response = await fetch('/usernfc/update/', {
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
      const res = await fetch(`/usernfc/nfcid/${nfcid}`);
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

  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center bg-white px-3 py-2.5 shadow-md flex-shrink-0 gap-2">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Back
        </button>

        <h2 className="text-base sm:text-lg font-bold text-gray-800">Select Machine</h2>

        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-gray-700">
            {wcMode === 'reguler' ? 'Reguler' : 'Overtime'}
          </span>
          <label className="relative inline-block w-10 h-5 sm:w-12 sm:h-6 cursor-pointer">
            <input
              type="checkbox"
              checked={wcMode === 'overtime'}
              onChange={(e) => handleModeToggle(e.target.checked)}
              className="hidden"
            />
            <span
              className={`
                absolute inset-0 rounded-full transition-colors duration-300
                ${wcMode === 'overtime' ? 'bg-orange-500' : 'bg-blue-500'}
                before:content-[''] before:absolute before:h-4 before:w-4 sm:before:h-5 sm:before:w-5
                before:left-0.5 before:bottom-0.5 before:bg-white before:rounded-full
                before:transition-transform before:duration-300
                ${wcMode === 'overtime' ? 'before:translate-x-5 sm:before:translate-x-6' : 'before:translate-x-0'}
              `}
            />
          </label>
        </div>

        <button
          onClick={loadMachines}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Search Row */}
      <div className="px-3 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search Machine..."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Machine List - Scrollable */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredMachines.length === 0 ? (
          <div className="text-center text-gray-500 mt-10">
            <p>Tidak ada mesin ditemukan</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredMachines.map((machine, index) => {
              const workcenterText = wcMode === 'overtime'
                ? machine.workcenterot
                : machine.workcenternew;

              return (
                <div
                  key={index}
                  onClick={() => handleSelectMachine(machine)}
                  className={`
                    relative bg-white rounded-lg shadow-md p-4 cursor-pointer
                    transition-all hover:shadow-lg hover:scale-105
                    ${wcMode === 'overtime'
                      ? 'border-2 border-orange-400 bg-orange-50'
                      : 'border border-gray-300'
                    }
                  `}
                >
                  {/* Overtime Badge */}
                  {wcMode === 'overtime' && (
                    <div className="absolute top-2 right-2 bg-orange-500 text-white text-xs font-bold px-2 py-1 rounded">
                      OT
                    </div>
                  )}

                  {/* Machine Title */}
                  <div className="text-base sm:text-lg font-bold text-gray-800 mb-3 pr-8">
                    {machine.workcenter_description}
                  </div>

                  {/* Machine Details */}
                  <div className="space-y-1.5">
                    <div className="flex text-xs sm:text-sm">
                      <span className="font-medium text-gray-600 w-24 flex-shrink-0">ID:</span>
                      <span className="font-semibold text-gray-800">{machine.machineid}</span>
                    </div>
                    <div className="flex text-xs sm:text-sm">
                      <span className="font-medium text-gray-600 w-24 flex-shrink-0">Group:</span>
                      <span className="font-semibold text-gray-800">{machine.groupname}</span>
                    </div>
                    <div className="flex text-xs sm:text-sm">
                      <span className="font-medium text-gray-600 w-24 flex-shrink-0">Workcenter:</span>
                      <span className="font-semibold text-gray-800">{workcenterText || '-'}</span>
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
