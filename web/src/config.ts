const API_KEY = 'passenger.apiBase';
const TOKEN_KEY = 'passenger.token';

const DEFAULT_API = (import.meta.env.VITE_PASSENGER_API ?? '').replace(/\/$/, '');
const DEFAULT_TOKEN = import.meta.env.VITE_PASSENGER_TOKEN ?? '';

export function getApiBase(): string {
  return (localStorage.getItem(API_KEY) || DEFAULT_API).replace(/\/$/, '');
}

export function setApiBase(v: string): void {
  localStorage.setItem(API_KEY, v.trim());
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN;
}

export function setToken(v: string): void {
  localStorage.setItem(TOKEN_KEY, v.trim());
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { 'x-passenger-token': t } : {};
}
