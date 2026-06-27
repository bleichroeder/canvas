import { Link } from '../router';

export function Chrome({ children }: { children: preact.ComponentChildren }) {
  return (
    <div>
      <header style={{
        display: 'flex', alignItems: 'center', padding: '12px 20px',
        borderBottom: '1px solid #232631', gap: 16, height: 56,
      }}>
        <Link to="/" style={{ fontWeight: 600, fontSize: 18, color: 'var(--fg)' }}>passenger</Link>
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          <Link to="/search" style={{ padding: '6px 12px' }}>🔍 Search</Link>
          <Link to="/settings" style={{ padding: '6px 12px' }}>⚙ Settings</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
