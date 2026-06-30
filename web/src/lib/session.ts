const BEARER_KEY = 'canvas:bearer';
const USER_KEY = 'canvas:user';

export interface SessionUser {
  id: number;
  label: string;
  role: 'admin' | 'member';
}

export function getBearer(): string | null {
  return localStorage.getItem(BEARER_KEY);
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionUser; } catch { return null; }
}

export function setSession(bearer: string, user: SessionUser): void {
  localStorage.setItem(BEARER_KEY, bearer);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(BEARER_KEY);
  localStorage.removeItem(USER_KEY);
}
