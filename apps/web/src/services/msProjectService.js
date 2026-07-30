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
    throw new Error(payload.message || payload.error || `Request failed: ${response.status}`);
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

export async function fetchSowOrders(params = {}) {
  const payload = await request(`/ms-project/sow-orders${queryString(params)}`);
  return payload.data || [];
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

export async function mapSowOrderToProjectTasks(projectId, payload) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/tasks/map-sow-order`, {
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

export async function fetchBaySchedules(params = {}) {
  const payload = await request(`/ms-project/bay-schedules${queryString(params)}`);
  return payload.data || [];
}

export async function createBaySchedule(payload) {
  const response = await request('/ms-project/bay-schedules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.data;
}

export async function cancelBaySchedule(scheduleId) {
  const response = await request(`/ms-project/bay-schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor: 'web-manufacturing' }),
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
  createBaySchedule,
  fetchBaySchedules,
  fetchMsProjectRevisions,
  fetchMsProjects,
  fetchMsProjectTasks,
  fetchOrderTasks,
  fetchSowOrders,
  fetchSowOrderOperations,
  forceCheckinProject,
  mapSowOrderToProjectTasks,
  msProjectFileUrl,
  updateMsProjectStatus,
  updateOperationPeople,
};
