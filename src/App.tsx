import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ChipLoader } from './components/ChipLoader.tsx';
import { Toasts } from './components/ui.tsx';
import { startAuth } from './store/auth.ts';

startAuth();

// The screens load as they're needed: until the first one has, Chip's loader (the same as
// index.html's) stays up rather than a blank page.
const router = createBrowserRouter([
  {
    HydrateFallback: ChipLoader,
    children: [
  { path: '/', lazy: () => import('./landing/Landing.tsx').then((m) => ({ Component: m.Landing })) },
  { path: '/signin', lazy: () => import('./pages/SignIn.tsx').then((m) => ({ Component: m.SignIn })) },
  { path: '/terms', lazy: () => import('./pages/Legal.tsx').then((m) => ({ Component: m.Terms })) },
  { path: '/privacy', lazy: () => import('./pages/Legal.tsx').then((m) => ({ Component: m.Privacy })) },
  {
    path: '/app',
    lazy: () => import('./pages/AppShell.tsx').then((m) => ({ Component: m.AppShell })),
    children: [
      { index: true, lazy: () => import('./pages/Dashboard.tsx').then((m) => ({ Component: m.Dashboard })) },
      { path: 'a/:id', lazy: () => import('./workspace/Workspace.tsx').then((m) => ({ Component: m.Workspace })) },
      { path: 'review', lazy: () => import('./pages/ReviewPage.tsx').then((m) => ({ Component: m.ReviewPage })) },
      { path: 'plan', lazy: () => import('./pages/PlanPage.tsx').then((m) => ({ Component: m.PlanPage })) },
      { path: 'settings', lazy: () => import('./pages/Settings.tsx').then((m) => ({ Component: m.Settings })) },
    ],
  },
  { path: '*', lazy: () => import('./pages/NotFound.tsx').then((m) => ({ Component: m.NotFound })) },
    ],
  },
]);

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  );
}
