const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function handle(res) {
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (Array.isArray(data.message) ? data.message.join(', ') : data.message)) ||
      `Request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

export function fetchJobs() {
  return fetch(`${API_URL}/jobs`).then(handle);
}

export function createJob(payload) {
  return fetch(`${API_URL}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(handle);
}

export function updateJobStatus(id, status) {
  return fetch(`${API_URL}/jobs/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }).then(handle);
}

export function deleteJob(id) {
  return fetch(`${API_URL}/jobs/${id}`, { method: 'DELETE' }).then(handle);
}
