import { useEffect, useState } from 'react';
import { getSupabase, type Session, type User } from './supabase';

export interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
}

/**
 * Subscribe to Supabase auth state. Returns `loading: true` until the initial
 * session check completes (matters for SSR-style boot — without it the UI
 * flashes "signed out" before settling on the real state).
 */
export function useAuth(): AuthState {
  const sb = getSupabase();
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: Boolean(sb),
  });

  useEffect(() => {
    if (!sb) {
      setState({ user: null, session: null, loading: false });
      return;
    }
    let cancelled = false;
    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setState({ user: data.session?.user ?? null, session: data.session, loading: false });
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, session, loading: false });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [sb]);

  return state;
}
