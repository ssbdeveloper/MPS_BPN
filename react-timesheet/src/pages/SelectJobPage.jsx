import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrowserMultiFormatReader } from '@zxing/library';

/**
 * Select Job Page
 * Converted dari menujob.html + script.js + scanbarcode.js
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
    // Auto load jika ada input
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
          // Filter dummy data by order
          const filtered = dummyData.filter(job =>
            job.order_no.includes(orderValue)
          );

          if (filtered.length > 0) {
            setJobs(filtered);
            sessionStorage.setItem('lastSearchOrder', orderValue);
            alert('⚠️ Menggunakan data dummy (API tidak tersedia)');
          } else {
            setJobs(dummyData); // Show all dummy data if no match
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

    // Navigate back to main menu
    setTimeout(() => {
      navigate('/timesheet-mainmenu');
    }, 300);
  };

  // Handle barcode scan
  const handleBarcodeScan = async () => {
    try {
      // Request camera permission first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });

      // Stop the permission stream (ZXing will create its own)
      stream.getTracks().forEach(track => track.stop());

      setShowScanner(true);

      if (!codeReaderRef.current) {
        codeReaderRef.current = new BrowserMultiFormatReader();
      }

      // Get video devices after permission granted
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      if (videoDevices.length === 0) {
        alert('Tidak ada kamera ditemukan');
        setShowScanner(false);
        return;
      }

      // Prefer back camera for mobile, default to first camera
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

  return (
    <div className="h-screen w-screen bg-gray-100 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center bg-white px-3 py-2.5 shadow-md flex-shrink-0">
        <button
          onClick={goBack}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Back
        </button>
        <h2 className="text-base sm:text-lg font-bold text-gray-800">Job Selection</h2>
        <button
          onClick={() => loaddatapgall()}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Refresh
        </button>
      </header>

      {/* Search Row */}
      <div className="flex gap-2 px-3 py-2 bg-white border-b border-gray-200 flex-shrink-0">
        <input
          type="text"
          value={orderInput}
          onChange={(e) => setOrderInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Search Order..."
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={() => loaddatapgall()}
          className="px-4 py-2 text-xs sm:text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Search
        </button>
        <button
          onClick={handleBarcodeScan}
          className="px-4 py-2 text-xs sm:text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Barcode
        </button>
      </div>

      {/* Table Header */}
      <div className="px-3 py-2 bg-gray-200 border-b border-gray-300 flex-shrink-0">
        <div className="grid gap-1 text-xs font-semibold text-gray-700" style={{ gridTemplateColumns: '1fr 1fr 2fr 60px 60px 1fr' }}>
          <div className="text-center">Order</div>
          <div className="text-center">Ident</div>
          <div className="text-center">Activity</div>
          <div className="text-center">Seq</div>
          <div className="text-center">Hours</div>
          <div className="text-center">Workcenter</div>
        </div>
      </div>

      {/* Job List - Scrollable */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {jobs.length === 0 ? (
          <div className="text-center text-gray-500 mt-10">
            <p>Tidak ada data. Silakan search order.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job, index) => (
              <div
                key={index}
                onClick={() => handleSelectJob(job)}
                className={`
                  bg-white rounded border border-gray-300
                  cursor-pointer transition-all hover:bg-blue-50 hover:border-blue-400
                  ${selectedJob?.order === job.order_no && selectedJob?.operation_no === job.operation_no
                    ? 'bg-blue-100 border-blue-500'
                    : ''
                  }
                `}
              >
                <div className="grid gap-1 p-2 items-center min-h-[60px]" style={{ gridTemplateColumns: '1fr 1fr 2fr 60px 60px 1fr' }}>
                  <div className="text-xs text-center font-semibold text-gray-800 break-words">
                    {job.order_no}
                  </div>
                  <div className="text-xs text-center text-gray-700 break-words">
                    {job.ssbr_id}
                  </div>
                  <div className="text-xs text-center text-gray-700 break-words leading-relaxed">
                    {job.operationtext}
                  </div>
                  <div className="text-xs text-center text-gray-700">
                    {job.operation_no}
                  </div>
                  <div className="text-xs text-center text-gray-700">
                    {job.planhours}
                  </div>
                  <div className="text-xs text-center text-gray-700 break-words">
                    {job.workcenter}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Barcode Scanner Overlay */}
      {showScanner && (
        <div
          className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50"
          onClick={closeScanner}
        >
          <div className="bg-white rounded-lg p-4 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Scan Barcode</h3>
              <button
                onClick={closeScanner}
                className="text-2xl text-gray-600 hover:text-gray-800"
              >
                ×
              </button>
            </div>
            <video
              ref={videoRef}
              autoPlay
              className="w-full h-64 bg-black rounded"
            />
            <p className="text-xs text-gray-500 text-center mt-2">
              Arahkan kamera ke barcode order
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SelectJobPage;
