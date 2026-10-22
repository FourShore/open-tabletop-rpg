import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Controller } from './Controller';
import { Home } from './Home';
import { Screen } from './Screen';
import './style.css';

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const m = path.match(/^\/(screen|play)\/([A-Za-z]{4})\/?$/);
  if (!m) return <Home />;
  const code = m[2].toUpperCase();
  return m[1] === 'screen' ? <Screen key={code} code={code} /> : <Controller key={code} code={code} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
