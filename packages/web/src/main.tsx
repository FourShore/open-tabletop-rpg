import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Controller } from './Controller';
import { Home } from './Home';
import { Screen } from './Screen';
import './style.css';

// The editor carries the pack validator, so it loads only when opened.
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  if (/^\/editor\/?$/.test(path))
    return (
      <Suspense fallback={<p className="muted center">Opening the editor…</p>}>
        <Editor />
      </Suspense>
    );
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
