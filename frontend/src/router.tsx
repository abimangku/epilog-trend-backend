import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { PinEntry } from './pages/PinEntry';
import { Pulse } from './pages/Pulse';
import { Explore } from './pages/Explore';
import { ForYou } from './pages/ForYou';
import { Brand } from './pages/Brand';
import { Saved } from './pages/Saved';
import { Patterns } from './pages/Patterns';
import { Settings } from './pages/Settings';
import { SystemStatus } from './pages/SystemStatus';

export const router = createBrowserRouter([
  {
    path: '/pin',
    element: <PinEntry />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ErrorBoundary><Pulse /></ErrorBoundary> },
      { path: 'explore', element: <ErrorBoundary><Explore /></ErrorBoundary> },
      { path: 'for-you', element: <ErrorBoundary><ForYou /></ErrorBoundary> },
      { path: 'brand/:name', element: <ErrorBoundary><Brand /></ErrorBoundary> },
      { path: 'saved', element: <ErrorBoundary><Saved /></ErrorBoundary> },
      { path: 'patterns', element: <ErrorBoundary><Patterns /></ErrorBoundary> },
      { path: 'settings', element: <ErrorBoundary><Settings /></ErrorBoundary> },
      { path: 'system', element: <ErrorBoundary><SystemStatus /></ErrorBoundary> },
    ],
  },
]);
