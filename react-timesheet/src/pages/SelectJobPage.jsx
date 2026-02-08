import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';

/**
 * Select Job Page
 * Converted dari menujob.html + script.js + scanbarcode.js
 * Color scheme: White 65%, Blue 25% (90% opacity), Orange 10% (CTA)
 */
const SelectJobPage = () => {
  const navigate = useNavigate();

  // States
  const [orderInput, setOrderInput] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);

  // Load data on mount
  useEffect(() => {
    const savedOrder = sessionStorage.getItem('lastSearchOrder');
    if (savedOrder) {
      setOrderInput(savedOrder);
      loaddatapgall(savedOrder);
    }
  }, []);

  // API: Load job data (all activities)
  const loaddatapgall = async (order) => {
    const orderValue = order || orderInput;
    if (!orderValue.trim()) {
      alert('Masukkan nomor order terlebih dahulu');
      return;
    }

    try {
      const response = await fetch(`/sow/${orderValue}`);
      if (!response.ok) {
        throw new Error('Gagal load data dari API');
      }
      const data = await response.json();

      if (data && data.length > 0) {
        setJobs(data);
        sessionStorage.setItem('lastSearchOrder', orderValue);
      } else {
        throw new Error('Data kosong dari API');
      }
    } catch (error) {
      console.error('Error loading jobs from API:', error);

      // Fallback to dummy data
      try {
        console.log('Loading dummy data...');
        const dummyResponse = await fetch('/dummy-jobs.json');
        if (dummyResponse.ok) {
          const dummyData = await dummyResponse.json();
          const filtered = dummyData.filter(job =>
            job.order_no.includes(orderValue)
          );

          if (filtered.length > 0) {
            setJobs(filtered);
            sessionStorage.setItem('lastSearchOrder', orderValue);
            alert('⚠️ Menggunakan data dummy (API tidak tersedia)');
          } else {
            setJobs(dummyData);
            alert('⚠️ Order tidak ditemukan, menampilkan semua data dummy');
          }
        } else {
          throw new Error('Dummy data tidak tersedia');
        }
      } catch (dummyError) {
        console.error('Error loading dummy data:', dummyError);
        alert('❌ Gagal load data dari API dan dummy file');
        setJobs([]);
      }
    }
  };

  // Handle job selection
  const handleSelectJob = (job) => {
    const rowData = {
      order: job.order_no,
      ssbr_id: job.ssbr_id,
      operationtext: job.operationtext,
      operation_no: job.operation_no,
      planhours: job.planhours,
      workcenter: job.workcenter,
    };

    setSelectedJob(rowData);
    sessionStorage.setItem('selectedactivity', JSON.stringify(rowData));

    setTimeout(() => {
      navigate('/timesheet-mainmenu');
    }, 300);
  };

  // Handle barcode scan
  const handleBarcodeScan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      stream.getTracks().forEach(track => track.stop());

      setShowScanner(true);

      if (!codeReaderRef.current) {
        codeReaderRef.current = new BrowserMultiFormatReader();
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      if (videoDevices.length === 0) {
        alert('Tidak ada kamera ditemukan');
        setShowScanner(false);
        return;
      }

      const backCamera = videoDevices.find(d =>
        d.label.toLowerCase().includes('back') ||
        d.label.toLowerCase().includes('rear')
      );
      const deviceId = backCamera ? backCamera.deviceId : videoDevices[0].deviceId;

      await codeReaderRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, err) => {
          if (result) {
            const scannedText = result.getText();
            setOrderInput(scannedText);
            codeReaderRef.current.reset();
            setShowScanner(false);
            loaddatapgall(scannedText);
          }
        }
      );
    } catch (err) {
      console.error('Barcode scan error:', err);
      setShowScanner(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        alert('Akses kamera ditolak. Silakan izinkan akses kamera di browser settings.');
      } else if (err.name === 'NotFoundError') {
        alert('Kamera tidak ditemukan pada device ini.');
      } else if (err.name === 'NotReadableError') {
        alert('Kamera sedang digunakan oleh aplikasi lain.');
      } else {
        alert('Gagal akses kamera: ' + err.message);
      }
    }
  };

  // Close scanner overlay
  const closeScanner = () => {
    if (codeReaderRef.current) {
      try {
        codeReaderRef.current.reset();
      } catch (err) {
        console.error('Error closing scanner:', err);
      }
    }
    setShowScanner(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (codeReaderRef.current) {
        try {
          codeReaderRef.current.reset();
        } catch (err) {
          console.error('Cleanup error:', err);
        }
      }
    };
  }, []);

  // Back to main menu
  const goBack = () => {
    navigate('/timesheet-mainmenu');
  };

  // Handle search on Enter key
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      loaddatapgall();
    }
  };

  // Common cell style
  const cellBase = 'px-2 py-2 text-[11px] align-middle';

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
        <h2 className="text-base sm:text-lg font-bold text-white">Job Selection</h2>
        <button
          onClick={() => loaddatapgall()}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Search Row */}
      <div className="flex gap-2 px-3 py-2 bg-blue-50 border-b border-blue-200 flex-shrink-0">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={orderInput}
            onChange={(e) => setOrderInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Search Order..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
          />
        </div>
        <button
          onClick={() => loaddatapgall()}
          className="px-4 py-2 text-xs sm:text-sm font-medium bg-blue-700 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Search
        </button>
        <button
          onClick={handleBarcodeScan}
          className="px-4 py-2 text-xs sm:text-sm font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-400 active:bg-orange-600 transition-colors"
        >
          Barcode
        </button>
      </div>

      {/* Table — native HTML table for perfect alignment */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <colgroup>
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '35%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>

          <thead className="sticky top-0 z-10">
            <tr className="bg-blue-100 border-b-2 border-blue-300">
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Order</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Ident</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Activity</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Seq</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Hours</th>
              <th className={`${cellBase} text-center font-bold text-blue-900`}>Workcenter</th>
            </tr>
          </thead>

          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-10">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-10 h-10 text-blue-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="text-sm">Tidak ada data. Silakan search order.</span>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map((job, index) => {
                const isSelected = selectedJob?.order === job.order_no && selectedJob?.operation_no === job.operation_no;
                const rowBg = isSelected
                  ? 'bg-blue-100 hover:bg-blue-150'
                  : (index % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-blue-50/30 hover:bg-blue-50');

                return (
                  <tr
                    key={index}
                    onClick={() => handleSelectJob(job)}
                    className={`${rowBg} border-b border-blue-100 transition-colors cursor-pointer active:bg-orange-50`}
                  >
                    <td className={`${cellBase} text-center font-semibold text-blue-900`}>
                      {job.order_no}
                    </td>
                    <td className={`${cellBase} text-center text-blue-700`}>
                      {job.ssbr_id}
                    </td>
                    <td className={`${cellBase} text-left text-gray-800`}>
                      <div className="font-medium leading-snug">{job.operationtext}</div>
                    </td>
                    <td className={`${cellBase} text-center text-gray-700`}>
                      {job.operation_no}
                    </td>
                    <td className={`${cellBase} text-center text-gray-700`}>
                      {job.planhours}
                    </td>
                    <td className={`${cellBase} text-center text-gray-800 font-medium`}>
                      {job.workcenter}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Barcode Scanner Overlay */}
      {showScanner && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50"
          onClick={closeScanner}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="bg-blue-900 px-5 py-3 flex justify-between items-center">
              <h3 className="text-base font-bold text-white">Scan Barcode</h3>
              <button
                onClick={closeScanner}
                className="text-2xl text-blue-200 hover:text-white transition-colors"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <video
                ref={videoRef}
                autoPlay
                className="w-full h-64 bg-black rounded-lg"
              />
              <p className="text-xs text-gray-500 text-center mt-2">
                Arahkan kamera ke barcode order
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectJobPage;
