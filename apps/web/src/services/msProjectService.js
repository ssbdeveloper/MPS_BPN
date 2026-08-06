const API_BASE = import.meta.env.VITE_API_URL || '';

function apiUrl(path) {
  return `${API_BASE.replace(/\/$/, '')}${path}`;
}

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

function authHeaders() {
  const user = readAuthUser();
  if (!user) return {};
  return {
    'x-user-id': user.id ? String(user.id) : '',
    'x-user-name': user.name || user.username || '',
    'x-user-role': user.roles || user.role || '',
  };
}

async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // `code` dan status HTTP ikut dibawa. Tanpa ini pemanggil terpaksa mendeteksi jenis error
    // dengan mencocokkan potongan TEKS pesan — dan itu langsung mati begitu pesannya
    // diterjemahkan (persis yang terjadi saat UI dikonversi ke Bahasa Inggris).
    const error = new Error(payload.message || payload.error || `Request failed: ${response.status}`);
    error.code = payload.code || null;
    error.status = response.status;
    error.details = Array.isArray(payload.details) ? payload.details : [];
    throw error;
  }

  return payload;
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

export async function fetchMsProjects(params = {}) {
  const payload = await request(`/ms-project/projects${queryString(params)}`);
  return payload.data || [];
}

export async function fetchMsProjectTasks(projectId, params = {}) {
  const payload = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/tasks${queryString(params)}`);
  return payload.data || [];
}

// CRUD project & task (ProjectBrowserPage) — rename, edit task, delete project.
export async function updateMsProject(projectId, payload) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function updateMsProjectTask(projectId, taskId, payload) {
  const response = await request(
    `/ms-project/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
  );
  return response.data;
}

export async function deleteMsProject(projectId, options = {}) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ force: !!options.force }),
  });
  return response.data;
}

// Paginasi endpoint ini nyata (limit default 50, MAX_LIMIT 100) dan meta-nya
// dikirim di `summary`, BUKAN di level atas envelope — lihat
// apps/api/controllers/msProjectController.js:paginationSummary(). Selama ini
// fetchSowOrders membuang seluruh envelope kecuali `data`, jadi pemanggil tidak
// pernah tahu daftarnya terpotong (A-10: 80 diminta dari pool 115).
//
// Bentuk lama fetchSowOrders (Array) DIPERTAHANKAN dengan sengaja: MapSapOperationPage
// memakai hasilnya langsung sebagai state array (`setSowOrders(await fetchSowOrders(...))`),
// jadi mengubahnya jadi objek akan memecah halaman itu tanpa terlihat sampai runtime.
// Yang butuh meta memanggil fetchSowOrdersPage().
//
// `options` diteruskan apa adanya ke fetch -> dipakai untuk { signal } AbortController.
export async function fetchSowOrdersPage(params = {}, options = {}) {
  const payload = await request(`/ms-project/sow-orders${queryString(params)}`, options);
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const summary = payload.summary || {};
  const asNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    rows,
    // Tanpa `total` dari server, satu-satunya angka jujur adalah jumlah baris yang
    // benar-benar diterima — jangan mengarang total yang lebih besar.
    total: asNumber(summary.total, rows.length),
    limit: asNumber(summary.limit, rows.length),
    offset: asNumber(summary.offset, 0),
  };
}

export async function fetchSowOrders(params = {}, options = {}) {
  const page = await fetchSowOrdersPage(params, options);
  return page.rows;
}

export async function fetchSowOrderOperations(orderNo) {
  const payload = await request(`/ms-project/sow-orders/${encodeURIComponent(orderNo)}/operations`);
  return payload.data || [];
}

// Task-level source for the bay-reservation picker. Unlike fetchSowOrderOperations
// (raw `sow` rows, no task_id/project_id), this returns ms_project_task rows that
// carry the task_id + project_id required to create a TASK-LEVEL bay schedule.
// Orders never mapped into an MS Project return [] (task-level assign impossible
// until the order is imported/mapped).
export async function fetchOrderTasks(orderNo) {
  const payload = await request(`/ms-project/sow-orders/${encodeURIComponent(orderNo)}/tasks`);
  return payload.data || [];
}

// Satu operasi -> satu node. Kirim SALAH SATU: target_task_id (assign ke task yang ada)
// atau target_parent_task_id (buat anak baru di bawah node itu).
// 409 yang mungkin muncul: ORDER_MAPPED_ELSEWHERE (operasi sudah dipetakan di project lain),
// TARGET_TASK_OCCUPIED (node tujuan sudah memegang operasi lain). Keduanya bisa dilewati
// dengan takeover: true.
export async function mapSowOperationToTask(projectId, payload) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/tasks/map-operation`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return response.data;
}

// Write planned headcount back onto sow (per-operation). `updates` is an array of
// { operation_no, people_required }; people_required null clears it. Returns { updated, requested }.
export async function updateOperationPeople(orderNo, updates) {
  const response = await request(`/ms-project/sow-orders/${encodeURIComponent(orderNo)}/operations/people`, {
    method: 'PATCH',
    body: JSON.stringify({ updates }),
  });
  return response.data;
}

// `options` diteruskan ke fetch supaya pemanggil bisa mengirim { signal }
// AbortController — peta area memuat ulang tiap kali rentang tanggal berubah dan
// respons lama yang datang belakangan bisa menimpa yang baru.
export async function fetchBaySchedules(params = {}, options = {}) {
  const payload = await request(`/ms-project/bay-schedules${queryString(params)}`, options);
  return payload.data || [];
}

// Penghuni bay pada rentang tanggal tertentu -> dipakai UI untuk peringatan lunak
// SEBELUM submit reservasi. `params.bay_codes` boleh array (digabung jadi CSV) dan
// `params.exclude_group_id` dipakai saat mengedit grup agar dirinya sendiri tidak
// ikut terhitung sebagai penghuni.
export async function fetchBayOccupants(params = {}) {
  const { bay_codes: bayCodes, ...rest } = params;
  const query = {
    ...rest,
    bay_codes: Array.isArray(bayCodes) ? bayCodes.join(',') : bayCodes,
  };
  const payload = await request(`/ms-project/bay-schedules/occupants${queryString(query)}`);
  const data = payload.data;
  // Server memotong daftar di 50 dan mengirim { rows, truncated, total }. Membuang dua flag
  // itu membuat panel menampilkan "5 penghuni" padahal sebenarnya 60 — dan karena overlap
  // sekarang murni informasional (D3), informasi yang tidak lengkap merusak satu-satunya
  // nilai yang tersisa dari fitur ini. Bentuk array lama tetap diterima pemanggil lain.
  if (Array.isArray(data)) return { rows: data, truncated: false, total: data.length };
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const total = Number(data?.total);
  return {
    rows,
    truncated: Boolean(data?.truncated),
    total: Number.isFinite(total) ? total : rows.length,
  };
}

// Sejak D3 bay TIDAK pernah eksklusif: overlap tidak lagi menghasilkan 409, selalu 201
// bila payload valid. Penghuni lain dikembalikan sebagai peringatan lunak di
// `warnings: [{ type: 'BAY_OVERLAP', occupants: [...] }]` (array kosong bila bersih).
// `warnings` ada di level atas envelope (bukan di `data`), jadi ditempelkan ke hasil
// di sini. Bentuk lama (isi `response.data`) tetap utuh supaya pemanggil lama aman.
export async function createBaySchedule(payload) {
  const response = await request('/ms-project/bay-schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    ...(response.data || {}),
    warnings: Array.isArray(response.warnings) ? response.warnings : [],
  };
}

// Aktor TIDAK lagi dikirim di body: backend memaksanya dari sesi lewat header
// x-user-id/x-user-name yang sudah dipasang authHeaders().
export async function cancelBaySchedule(scheduleId) {
  const response = await request(`/ms-project/bay-schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
  });
  return response.data;
}

// Satu reservasi = satu schedule_group_id (N baris task). Update grup menggeser
// tanggal / mengganti bay / menambah-hapus task dalam satu transaksi.
// Server menghitung ulang overlap setelah bay/tanggal berubah dan mengirimnya sebagai
// warning BAY_OVERLAP di level atas envelope — sama seperti createBaySchedule. Kalau
// `warnings` dibuang di sini, peringatan lunak D3 hilang persis di jalur yang paling
// mungkin menciptakan tumpang tindih baru (menggeser reservasi ke bay yang sudah terisi).
export async function updateBayScheduleGroup(groupId, payload) {
  const response = await request(`/ms-project/bay-schedules/group/${encodeURIComponent(groupId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return {
    ...(response.data || {}),
    warnings: Array.isArray(response.warnings) ? response.warnings : [],
  };
}

// Batalkan SELURUH baris satu reservasi sekaligus (atomik di server), pengganti
// perulangan cancelBaySchedule per schedule_id.
export async function cancelBayScheduleGroup(groupId) {
  const response = await request(`/ms-project/bay-schedules/group/${encodeURIComponent(groupId)}`, {
    method: 'DELETE',
  });
  return response.data;
}

export async function forceCheckinProject(projectId, payload = {}) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/force-checkin`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export function msProjectFileUrl(projectId) {
  return apiUrl(`/ms-project/projects/${encodeURIComponent(projectId)}/file`);
}

export async function fetchMsProjectRevisions(projectId, params = {}) {
  const payload = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/revisions${queryString(params)}`);
  return payload.data || [];
}

export async function updateMsProjectStatus(projectId, status, actor) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, actor }),
  });
  return response.data;
}

export default {
  cancelBaySchedule,
  cancelBayScheduleGroup,
  createBaySchedule,
  fetchBayOccupants,
  fetchBaySchedules,
  fetchMsProjectRevisions,
  fetchMsProjects,
  fetchMsProjectTasks,
  fetchOrderTasks,
  fetchSowOrders,
  fetchSowOrdersPage,
  fetchSowOrderOperations,
  forceCheckinProject,
  mapSowOperationToTask,
  msProjectFileUrl,
  updateBayScheduleGroup,
  updateMsProjectStatus,
  updateOperationPeople,
};
