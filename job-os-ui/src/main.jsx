/**
 * main.jsx — entry point and the one place that decides which app runs.
 *
 * Three surfaces now share this bundle:
 *   /              the candidate app (App.jsx)
 *   /employer      the hiring console (employer/EmployerApp.jsx)
 *   /apply/:id     the page an employer posting's apply link points at
 *
 * A PATH CHECK RATHER THAN A ROUTER, deliberately. react-router is already
 * a dependency, but App.jsx keeps its five surfaces in component state and
 * has no routes to hang off; introducing a router here would mean rewriting
 * that navigation to gain nothing at three static paths. If a fourth path
 * with real parameters shows up, this is the function to replace.
 */
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
const App=lazy(()=>import('./App.jsx'));
const EmployerApp=lazy(()=>import('./employer/EmployerApp.jsx'));
const ApplyPage=lazy(()=>import('./ApplyPage.jsx'));

function Surface() {
  const path = window.location.pathname;

  if (path === '/employer' || path.startsWith('/employer/')) return <EmployerApp />;

  const apply = path.match(/^\/apply\/([0-9a-f-]{36})\/?$/i);
  if (apply) return <ApplyPage postingId={apply[1]} />;

  return <App />;
}

export function Root(){return <Suspense fallback={<div role="status" style={{padding:40,fontFamily:'system-ui'}}>Loading JobCopilot…</div>}><Surface/></Suspense>;}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

