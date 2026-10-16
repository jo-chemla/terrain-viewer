import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The app's own Tailwind + shadcn theme tokens (:root / .dark), so this page looks like a panel of the app.
import '@/src/index.css';
import './styles.css';

// Light or dark follows the system unless the toggle in the header chose; `.dark` on <html> is the app's convention.
const stored = localStorage.getItem('ux-flows-theme');
const dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.classList.toggle('dark', dark);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
