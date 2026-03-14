import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { PinEntry } from './pages/PinEntry';
import { Pulse } from './pages/Pulse';
import { Explore } from './pages/Explore';
import { ForYou } from './pages/ForYou';
import { Brand } from './pages/Brand';
import { Saved } from './pages/Saved';
import { Patterns } from './pages/Patterns';
import { Settings } from './pages/Settings';

export const router = createBrowserRouter([
  {
    path: '/pin',
    element: <PinEntry />,
  },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Pulse /> },
      { path: 'explore', element: <Explore /> },
      { path: 'for-you', element: <ForYou /> },
      { path: 'brand/:name', element: <Brand /> },
      { path: 'saved', element: <Saved /> },
      { path: 'patterns', element: <Patterns /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);
