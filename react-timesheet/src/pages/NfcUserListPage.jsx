import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Search, Pencil, Trash2, AlertTriangle, Plus } from 'lucide-react';
import PasswordPrompt from '../components/auth/PasswordPrompt';

const API_BASE = import.meta.env.VITE_API_URL || '';

const NfcUserListPage = () => {
  const navigate = useNavigate();

  const [allData, setAllData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteModal, setDeleteModal] = useState({
    show: false,
    nfcid: '',
    full_name: '',
    snssb: ''
  });
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadNfcUsers();
  }, []);

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return allData;
    const term = searchTerm.toLowerCase().trim();
    return allData.filter(user =>
      (user.full_name || '').toLowerCase().includes(term) ||
      (user.snssb || '').toLowerCase().includes(term) ||
      (user.nfcid || '').toLowerCase().includes(term) ||
      (user.machinename || '').toLowerCase().includes(term)
    );
  }, [allData, searchTerm]);

  const loadNfcUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/usernfc`);
      if (!response.ok) throw new Error('Failed to fetch');
      const data = await response.json();
      setAllData(data);
    } catch (err) {
      console.error('Error loading NFC users:', err);
      showStatus('error', 'Gagal memuat data NFC users');
    } finally {
      setLoading(false);
    }
  };

  const showStatus = (type, text) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage({ type: '', text: '' }), 5000);
  };

  const handleDeleteClick = (user) => {
    setDeleteModal({ show: true, nfcid: user.nfcid, full_name: user.full_name, snssb: user.snssb });
  };

  const closeDeleteModal = () => {
    setDeleteModal({ show: false, nfcid: '', full_name: '', snssb: '' });
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      // encodeURIComponent penting — NFC ID bisa mengandung karakter khusus
      const response = await fetch(`${API_BASE}/usernfc/${encodeURIComponent(deleteModal.nfcid)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        const errMsg = errBody?.error || errBody?.message || `Server error ${response.status}`;
        throw new Error(errMsg);
      }


      setAllData(prev => prev.filter(u => u.nfcid !== deleteModal.nfcid));
      showStatus('success', 'User berhasil dihapus');
      closeDeleteModal();
    } catch (err) {
      console.error('Error deleting user:', err);
      showStatus('error', `Gagal menghapus: ${err.message}`);
      closeDeleteModal();
    } finally {
      setDeleting(false);
    }
  };

  const handleEditClick = (nfcid) => {
    navigate(`/create-edit-nfc?edit=${encodeURIComponent(nfcid)}`);
  };

  return (
    <PasswordPrompt password="12345">
      <div className="h-dvh w-screen bg-slate-50 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between px-4 md:px-6 py-2.5 bg-white border-b border-slate-200 shadow-sm">
          <button
            onClick={() => navigate('/operations-hub')}
            className="min-h-[44px] flex items-center bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          >
            ← Back
          </button>
          <h1 className="text-sm md:text-base font-extrabold text-slate-800">NFC User Management</h1>
          <button
            onClick={() => navigate('/create-edit-nfc')}
            className="min-h-[44px] flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white px-3 md:px-4 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">Create New</span>
            <span className="sm:hidden">New</span>
          </button>
        </header>

        {/* Status Message */}
        {statusMessage.text && (
          <div className={`flex-shrink-0 px-4 py-2.5 text-xs font-semibold text-center ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 border-b border-emerald-200'
              : 'bg-red-50 text-red-700 border-b border-red-200'
          }`}>
            {statusMessage.text}
          </div>
        )}

        {/* Search toolbar */}
        <div className="flex-shrink-0 px-4 md:px-6 py-3 bg-white border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
              placeholder="Search by name, SNSSB, NFC ID, or machine..."
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {!loading && (
            <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
              <span>
                Showing <span className="font-semibold text-slate-700">{filteredData.length}</span> of{' '}
                <span className="font-semibold text-slate-700">{allData.length}</span> users
              </span>
              {searchTerm && (
                <span>Hasil untuk: "<span className="font-medium text-slate-700">{searchTerm}</span>"</span>
              )}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden px-4 md:px-6 py-3">
          <div className="h-full bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="animate-spin w-10 h-10 border-4 border-[#00b4d8] border-t-transparent rounded-full mx-auto mb-3" />
                  <p className="text-sm text-slate-500">Loading...</p>
                </div>
              </div>
            ) : filteredData.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center px-4">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Search className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 mb-1">
                    {allData.length === 0 ? 'Tidak ada data NFC user' : 'Tidak ada hasil'}
                  </p>
                  {searchTerm && (
                    <p className="text-xs text-slate-400">Tidak ditemukan untuk: "{searchTerm}"</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr style={{ background: '#caf0f8' }}>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap">NFC ID</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap">Full Name</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap">SNSSB</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap hidden md:table-cell">Machine ID</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap hidden md:table-cell">Machine Name</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap hidden md:table-cell">Work Center</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap">Role</th>
                      <th className="px-3 py-2.5 text-center font-semibold text-slate-700 whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredData.map((user) => (
                      <tr key={user.nfcid} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 font-mono font-semibold text-[#0096c7]">
                          {user.nfcid}
                        </td>
                        <td className="px-3 py-2 text-slate-800">
                          {highlightMatch(user.full_name || '', searchTerm)}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-700">
                          {highlightMatch(user.snssb || '', searchTerm)}
                        </td>
                        <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{user.machineid || '-'}</td>
                        <td className="px-3 py-2 text-slate-600 hidden md:table-cell">
                          {highlightMatch(user.machinename || '', searchTerm)}
                        </td>
                        <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{user.workcenter || '-'}</td>
                        <td className="px-3 py-2">
                          <RoleBadge role={user.roles} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1.5 justify-center">
                            <button
                              onClick={() => handleEditClick(user.nfcid)}
                              className="min-h-[32px] flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-[#0096c7] hover:bg-[#0077b6] text-white rounded-lg transition-all active:scale-95"
                            >
                              <Pencil size={12} />Edit
                            </button>
                            <button
                              onClick={() => handleDeleteClick(user)}
                              className="min-h-[32px] flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all active:scale-95"
                            >
                              <Trash2 size={12} />Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {deleteModal.show && (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm px-0 md:px-4">
            <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <h3 className="text-base font-bold text-slate-800">Konfirmasi Hapus</h3>
              </div>

              <p className="text-sm text-slate-600 mb-4">
                Apakah Anda yakin ingin menghapus user berikut?
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 space-y-1.5">
                <div className="flex text-xs">
                  <span className="font-semibold text-slate-500 w-24">NFC ID</span>
                  <span className="font-mono font-bold text-slate-800">{deleteModal.nfcid}</span>
                </div>
                <div className="flex text-xs">
                  <span className="font-semibold text-slate-500 w-24">Full Name</span>
                  <span className="text-slate-800">{deleteModal.full_name}</span>
                </div>
                <div className="flex text-xs">
                  <span className="font-semibold text-slate-500 w-24">SNSSB</span>
                  <span className="font-medium text-slate-800">{deleteModal.snssb}</span>
                </div>
              </div>

              <p className="text-xs text-red-600 mb-6">
                Aksi ini tidak dapat dibatalkan. Data akan dihapus secara permanen.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={closeDeleteModal}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Batal
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold bg-red-600 hover:bg-red-500 text-white rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {deleting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  {deleting ? 'Menghapus...' : 'Hapus'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PasswordPrompt>
  );
};

const RoleBadge = ({ role }) => {
  const styles = {
    Admin:      'bg-purple-100 text-purple-700 border-purple-200',
    Supervisor: 'bg-[#caf0f8] border-[#90e0ef] text-[#0077b6]',
    Technician: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  };
  const cls = styles[role] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
      {role || '-'}
    </span>
  );
};

const highlightMatch = (text, searchTerm) => {
  if (!searchTerm.trim() || !text) return text;
  const term = searchTerm.toLowerCase();
  const lowerText = text.toLowerCase();
  if (!lowerText.includes(term)) return text;
  const parts = text.split(new RegExp(`(${searchTerm.trim()})`, 'gi'));
  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === term ? (
          <mark key={i} className="bg-amber-100 text-amber-800 px-0.5 rounded">
            {part}
          </mark>
        ) : part
      )}
    </span>
  );
};

export default NfcUserListPage;
