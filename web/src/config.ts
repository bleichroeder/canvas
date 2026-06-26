const API_KEY = 'passenger.apiBase';
const TOKEN_KEY = 'passenger.token';

export function getApiBase(): string {
  return (localStorage.getItem(API_KEY) || '').replace(/\/$/, '');
}

export function setApiBase(v: string): void {
  localStorage.setItem(API_KEY, v.trim());
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(v: string): void {
  localStorage.setItem(TOKEN_KEY, v.trim());
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { 'x-passenger-token': t } : {};
}
