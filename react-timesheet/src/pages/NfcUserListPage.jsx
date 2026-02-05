import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PasswordPrompt from '../components/auth/PasswordPrompt';

/**
 * NFC User List Page
 * Converted from editnfc.html with improvements
 * Features:
 * - Password protection (12345)
 * - List all NFC users in table
 * - Real-time search by name or SNSSB
 * - Delete with modal confirmation
 * - Loading states and error handling
 * - Color scheme: White 65%, Blue 25%, Orange 10%
 */
const NfcUserListPage = () => {
  const navigate = useNavigate();

  // States
  const [allData, setAllData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [searchSnssb, setSearchSnssb] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteModal, setDeleteModal] = useState({
    show: false,
    nfcid: '',
    full_name: '',
    snssb: ''
  });
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Load all NFC users on mount
  useEffect(() => {
    loadNfcUsers();
  }, []);

  // Filter data when search inputs change
  useEffect(() => {
    const filtered = allData.filter(user => {
      const nameMatch = user.full_name.toLowerCase().includes(searchName.toLowerCase().trim());
      const snssMatch = user.snssb.toLowerCase().includes(searchSnssb.toLowerCase().trim());

      // OR logic: match if either name or SNSSB matches
      if (searchName.trim() && searchSnssb.trim()) {
        return nameMatch || snssMatch;
      } else if (searchName.trim()) {
        return nameMatch;
      } else if (searchSnssb.trim()) {
        return snssMatch;
      }
      return true; // No search filters
    });
    setFilteredData(filtered);
  }, [searchName, searchSnssb, allData]);

  // Load NFC users from API
  const loadNfcUsers = async () => {
    setLoading(true);
    try {
      // PRODUCTION: Uncomment this
      // const response = await fetch('/usernfc');
      // if (!response.ok) throw new Error('Failed to fetch');
      // const data = await response.json();
      // setAllData(data);
      // setFilteredData(data);

      // DEVELOPMENT: Dummy data
      const response = await fetch('/dummy-nfc-users.json');
      const data = await response.json();
      setAllData(data);
      setFilteredData(data);
    } catch (err) {
      console.error('Error loading NFC users:', err);
      showStatus('error', '❌ Gagal memuat data NFC users');
    } finally {
      setLoading(false);
    }
  };

  // Show status message
  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => {
      setStatusMessage({ type: '', text: '' });
    }, 5000);
  };

  // Open delete confirmation modal
  const handleDeleteClick = (user) => {
    setDeleteModal({
      show: true,
      nfcid: user.nfcid,
      full_name: user.full_name,
      snssb: user.snssb
    });
  };

  // Close delete modal
  const closeDeleteModal = () => {
    setDeleteModal({
      show: false,
      nfcid: '',
      full_name: '',
      snssb: ''
    });
  };

  // Confirm delete
  const confirmDelete = async () => {
    try {
      // PRODUCTION: Uncomment this
      // const response = await fetch(`/usernfc/${deleteModal.nfcid}`, {
      //   method: 'DELETE'
      // });
      // if (!response.ok) throw new Error('Failed to delete');

      // DEVELOPMENT: Simulate success
      console.log('Deleting user:', deleteModal.nfcid);

      // Remove from local state
      const updatedData = allData.filter(user => user.nfcid !== deleteModal.nfcid);
      setAllData(updatedData);
      setFilteredData(updatedData);

      showStatus('success', '✅ User berhasil dihapus');
      closeDeleteModal();
    } catch (err) {
      console.error('Error deleting user:', err);
      showStatus('error', '❌ Gagal menghapus user');
    }
  };

  // Navigate to edit page
  const handleEditClick = (nfcid) => {
    navigate(`/create-edit-nfc?edit=${nfcid}`);
  };

  return (
    <PasswordPrompt password="12345">
      <div className="h-screen w-screen bg-white flex flex-col overflow-hidden">
        {/* Header - Dark Blue */}
        <header className="flex justify-between items-center bg-blue-900 px-4 py-3 shadow-md flex-shrink-0">
          <button
            onClick={() => navigate('/timesheet-mainmenu')}
            className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded shadow-lg hover:shadow-xl active:shadow-sm active:translate-y-1 transition-all duration-150 transform"
            style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-white">NFC User Management</h1>
          <div className="w-20"></div> {/* Spacer */}
        </header>

        {/* Status Message */}
        {statusMessage.text && (
          <div className={`px-4 py-3 text-sm font-medium text-center ${
            statusMessage.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {statusMessage.text}
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col gap-3 p-4 overflow-hidden">
          {/* Search and Create Section */}
          <section className="bg-blue-50 rounded-lg shadow-md border border-blue-200 p-4 flex-shrink-0">
            <div className="flex flex-col lg:flex-row gap-3 items-end">
              {/* Search Inputs */}
              <div className="flex-1 flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-blue-900 mb-1">
                    Search by Name
                  </label>
                  <input
                    type="text"
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Budi Santoso"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-blue-900 mb-1">
                    Search by SNSSB
                  </label>
                  <input
                    type="text"
                    value={searchSnssb}
                    onChange={(e) => setSearchSnssb(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., EMP001"
                  />
                </div>
              </div>

              {/* Create New Button - Orange CTA */}
              <button
                onClick={() => navigate('/create-edit-nfc')}
                className="px-6 py-2 text-sm font-bold bg-gradient-to-b from-orange-500 to-orange-600 text-white rounded shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1 transition-all duration-150 transform whitespace-nowrap"
                style={{ boxShadow: '0 6px 12px -2px rgba(249, 115, 22, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.3)' }}
              >
                + Create New User
              </button>
            </div>

            {/* Results Count */}
            {!loading && (
              <div className="mt-2 text-xs text-blue-900">
                Showing <span className="font-bold">{filteredData.length}</span> of <span className="font-bold">{allData.length}</span> users
              </div>
            )}
          </section>

          {/* Table Section */}
          <section className="flex-1 bg-blue-50 rounded-lg shadow-md border border-blue-200 overflow-hidden flex flex-col">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-blue-900 border-t-transparent rounded-full mx-auto mb-3"></div>
                  <p className="text-blue-900 font-medium">Loading...</p>
                </div>
              </div>
            ) : filteredData.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <svg className="w-16 h-16 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                  <p className="text-gray-600 font-medium">
                    {allData.length === 0 ? 'Tidak ada data NFC user' : 'Tidak ada hasil untuk pencarian ini'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-blue-700 text-white">
                    <tr>
                      <th className="px-3 py-3 text-left">NFC ID</th>
                      <th className="px-3 py-3 text-left">Full Name</th>
                      <th className="px-3 py-3 text-left">SNSSB</th>
                      <th className="px-3 py-3 text-left">Machine ID</th>
                      <th className="px-3 py-3 text-left">Machine Name</th>
                      <th className="px-3 py-3 text-left">Work Center</th>
                      <th className="px-3 py-3 text-left">Role</th>
                      <th className="px-3 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {filteredData.map((user, index) => (
                      <tr
                        key={user.nfcid}
                        className={`border-b border-blue-200 hover:bg-blue-100 transition-colors ${
                          index % 2 === 0 ? 'bg-white' : 'bg-blue-50'
                        }`}
                      >
                        <td className="px-3 py-2 font-mono font-semibold text-blue-900">{user.nfcid}</td>
                        <td className="px-3 py-2">{user.full_name}</td>
                        <td className="px-3 py-2 font-medium">{user.snssb}</td>
                        <td className="px-3 py-2">{user.machineid || '-'}</td>
                        <td className="px-3 py-2">{user.machinename || '-'}</td>
                        <td className="px-3 py-2">{user.workcenter || '-'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            user.roles === 'Admin' ? 'bg-purple-100 text-purple-800' :
                            user.roles === 'Supervisor' ? 'bg-blue-100 text-blue-800' :
                            user.roles === 'Technician' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.roles || '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() => handleEditClick(user.nfcid)}
                              className="px-3 py-1 text-xs font-medium bg-blue-700 text-white rounded shadow-md hover:shadow-lg active:shadow-sm active:translate-y-0.5 transition-all duration-150 transform"
                              style={{ boxShadow: '0 3px 6px -1px rgba(37, 99, 235, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              onClick={() => handleDeleteClick(user)}
                              className="px-3 py-1 text-xs font-medium bg-red-600 text-white rounded shadow-md hover:shadow-lg active:shadow-sm active:translate-y-0.5 transition-all duration-150 transform"
                              style={{ boxShadow: '0 3px 6px -1px rgba(220, 38, 38, 0.4), 0 2px 4px -1px rgba(0, 0, 0, 0.2)' }}
                            >
                              🗑️ Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>

        {/* Delete Confirmation Modal */}
        {deleteModal.show && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md">
              <h3 className="text-lg font-bold text-blue-900 mb-4">⚠️ Konfirmasi Hapus</h3>
              <p className="text-sm text-gray-700 mb-4">
                Apakah Anda yakin ingin menghapus user berikut?
              </p>

              {/* User Details */}
              <div className="bg-blue-50 rounded-lg p-3 mb-4 border border-blue-200">
                <div className="text-xs space-y-1">
                  <div className="flex">
                    <span className="font-medium text-blue-900 w-24">NFC ID:</span>
                    <span className="font-mono font-semibold">{deleteModal.nfcid}</span>
                  </div>
                  <div className="flex">
                    <span className="font-medium text-blue-900 w-24">Full Name:</span>
                    <span>{deleteModal.full_name}</span>
                  </div>
                  <div className="flex">
                    <span className="font-medium text-blue-900 w-24">SNSSB:</span>
                    <span className="font-medium">{deleteModal.snssb}</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-red-600 mb-4">
                ⚠️ Aksi ini tidak dapat dibatalkan. Data akan dihapus secara permanen.
              </p>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={closeDeleteModal}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-gray-300 text-gray-800 rounded shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1 transition-all duration-150 transform"
                  style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2), 0 2px 4px -1px rgba(0, 0, 0, 0.15)' }}
                >
                  Batal
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 px-4 py-2 text-sm font-bold bg-gradient-to-b from-red-500 to-red-600 text-white rounded shadow-lg hover:shadow-xl active:shadow-md active:translate-y-1 transition-all duration-150 transform"
                  style={{ boxShadow: '0 6px 12px -2px rgba(220, 38, 38, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.3)' }}
                >
                  🗑️ Hapus
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PasswordPrompt>
  );
};

export default NfcUserListPage;
