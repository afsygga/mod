import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './hooks/useAuth';
import './index.css';

const versionBadge = document.createElement('div');
versionBadge.textContent = __APP_VERSION__;
Object.assign(versionBadge.style, {
  position: 'fixed', bottom: '8px', right: '10px', zIndex: '99999',
  fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontFamily: 'monospace',
  pointerEvents: 'none', userSelect: 'none',
});
document.body.appendChild(versionBadge);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
