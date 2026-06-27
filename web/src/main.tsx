import { render } from 'preact';

function App() {
  return <div style={{ padding: '20px', fontFamily: 'system-ui' }}>
    <h1>passenger v2</h1>
    <p>scaffold OK</p>
  </div>;
}

const root = document.getElementById('app');
if (root) render(<App />, root);
