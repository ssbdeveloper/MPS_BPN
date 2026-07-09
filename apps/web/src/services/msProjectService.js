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

export async function mapSowOrderToProjectTasks(projectId, payload) {
  const response = await request(`/ms-project/projects/${encodeURIComponent(projectId)}/tasks/map-sow-order`, {
    method: 'PUT',
    body: JSON.stringify(payload),
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
  fetchSowOrders,
  fetchSowOrderOperations,
  forceCheckinProject,
  mapSowOrderToProjectTasks,
  msProjectFileUrl,
  updateMsProjectStatus,
};
