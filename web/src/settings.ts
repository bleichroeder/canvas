import { getApiBase, setApiBase, getToken, setToken } from './config';

const apiInput = document.getElementById('api-base') as HTMLInputElement | null;
const tokenInput = document.getElementById('token') as HTMLInputElement | null;
const form = document.getElementById('settings-form') as HTMLFormElement | null;
const status = document.getElementById('settings-status');

if (apiInput) apiInput.value = getApiBase();
if (tokenInput) tokenInput.value = getToken();

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (apiInput) setApiBase(apiInput.value);
  if (tokenInput) setToken(tokenInput.value);
  if (status) {
    status.textContent = 'Saved.';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});

