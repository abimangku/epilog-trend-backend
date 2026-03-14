const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('tw_token');
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function verifyPin(pin: string): Promise<string> {
  const { token } = await apiFetch<{ token: string }>('/auth/pin', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  localStorage.setItem('tw_token', token);
  return token;
}

export async function verifySession(): Promise<boolean> {
  try {
    await apiFetch('/auth/verify');
    return true;
  } catch {
    localStorage.removeItem('tw_token');
    return false;
  }
}
