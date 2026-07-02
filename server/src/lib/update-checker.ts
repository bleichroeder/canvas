export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  publishedAt: string | null;
  releaseNotes: string | null;
  htmlUrl: string | null;
  checkedAt: string;
  error: string | null;
}

const GITHUB_URL = 'https://api.github.com/repos/bleichroeder/canvas/releases/latest';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  data: UpdateStatus;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<UpdateStatus> | null = null;

export function __resetForTests(): void {
  cache = null;
  inFlight = null;
}

function parseVersion(v: string): number[] | null {
  const cleaned = v.startsWith('v') ? v.slice(1) : v;
  const parts = cleaned.split('.');
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums;
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (av === null && bv === null) return 0;
  if (av === null) return -1; // unparseable/dev < any real version
  if (bv === null) return 1;
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

async function fetchFromGitHub(currentVersion: string): Promise<UpdateStatus> {
  const now = new Date().toISOString();
  const empty: UpdateStatus = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    publishedAt: null,
    releaseNotes: null,
    htmlUrl: null,
    checkedAt: now,
    error: null,
  };

  let res: Response;
  try {
    res = await fetch(GITHUB_URL, {
      headers: { 'accept': 'application/vnd.github+json' },
    });
  } catch {
    return { ...empty, error: 'GitHub API unavailable' };
  }

  if (res.status === 404) {
    return { ...empty, error: 'no releases published yet' };
  }
  if (res.status === 403) {
    return { ...empty, error: 'rate limited' };
  }
  if (res.status >= 500) {
    return { ...empty, error: 'GitHub API unavailable' };
  }
  if (!res.ok) {
    return { ...empty, error: `GitHub API returned ${res.status}` };
  }

  let body: {
    tag_name?: unknown;
    published_at?: unknown;
    body?: unknown;
    html_url?: unknown;
  };
  try {
    body = await res.json() as typeof body;
  } catch {
    return { ...empty, error: 'GitHub API returned invalid JSON' };
  }

  const latestVersion = typeof body.tag_name === 'string' ? body.tag_name : null;
  const publishedAt = typeof body.published_at === 'string' ? body.published_at : null;
  const releaseNotes = typeof body.body === 'string' ? body.body : null;
  const htmlUrl = typeof body.html_url === 'string' ? body.html_url : null;

  if (!latestVersion) {
    return { ...empty, error: 'GitHub API returned no tag_name' };
  }

  const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    publishedAt,
    releaseNotes,
    htmlUrl,
    checkedAt: now,
    error: null,
  };
}

export async function getUpdateStatus(currentVersion: string): Promise<UpdateStatus> {
  const now = Date.now();
  if (cache !== null && now - cache.fetchedAt < TTL_MS) {
    return { ...cache.data, currentVersion };
  }
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    try {
      const data = await fetchFromGitHub(currentVersion);
      // Cache even error results (except transient 5xx if we have a stale cache — see below).
      if (data.error === 'GitHub API unavailable' && cache !== null) {
        // Prefer stale cache over transient error.
        return { ...cache.data, currentVersion, checkedAt: new Date().toISOString() };
      }
      cache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
