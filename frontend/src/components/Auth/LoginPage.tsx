import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Footer } from '../Footer/Footer';

const BASE = import.meta.env.VITE_API_URL || '';

declare global {
  interface Window { google?: any; }
}

export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [blockedEmail, setBlockedEmail] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Use build-time env var first (always available, even when backend is down)
    const buildTimeId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (buildTimeId) { setClientId(buildTimeId); return; }
    // Fallback: fetch from backend
    fetch(`${BASE}/api/auth/config`).then(r => r.json()).then(d => setClientId(d.google_client_id)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId || blockedEmail) return;
    // Load Google Identity script
    const existing = document.querySelector('script[data-gsi]');
    if (existing) initGoogle();
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.dataset.gsi = '1';
      s.onload = initGoogle;
      document.head.appendChild(s);
    }
    function initGoogle() {
      if (!window.google || !btnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async (resp: any) => {
          // Always extract the email from the credential — even before backend call
          let emailFromCredential: string | null = null;
          try {
            const payload = JSON.parse(atob(resp.credential.split('.')[1]));
            emailFromCredential = payload.email || null;
          } catch {}

          const r = await loginWithGoogle(resp.credential);
          if (!r.ok) {
            // Show the blocked-email screen for ANY denial reason where we know the email
            if (emailFromCredential) {
              setBlockedEmail(emailFromCredential);
            }
            // Disable Google auto-select so user can pick another account
            try {
              window.google.accounts.id.disableAutoSelect();
            } catch {}
            if (r.error === 'not whitelisted') {
              setError('not whitelisted');
            } else if (r.error === 'account disabled') {
              setError('account disabled');
            } else {
              setError(r.error || 'login failed');
            }
          }
        },
      });
      window.google.accounts.id.renderButton(btnRef.current, {
        theme: 'filled_black',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 272,
      });
    }
  }, [clientId, loginWithGoogle, blockedEmail]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden', background: '#050508',
    }}>
      {/* Ambient glow — тёплый за лого, фиолетовый в углу */}
      <div style={{
        position: 'absolute', top: '-160px', left: '50%', transform: 'translateX(-50%)',
        width: '620px', height: '620px', borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(255,200,0,0.055) 0%, transparent 62%)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-240px', right: '-160px',
        width: '560px', height: '560px', borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(circle, rgba(160,112,255,0.05) 0%, transparent 62%)',
      }} />

      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px', position: 'relative',
      }}>
        <AnimatePresence mode="wait">
          {!blockedEmail ? (
            <motion.div key="login"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center', width: '100%', maxWidth: '340px',
              }}>

              {/* Logo + название — без изменений по сути, крупнее и чище */}
              <img src="/lightning.gif" alt=""
                style={{
                  width: '72px', height: '72px', objectFit: 'contain', marginBottom: '18px',
                  filter: 'drop-shadow(0 0 28px rgba(255,200,0,0.5))',
                }} />
              <h1 style={{
                fontSize: '28px', fontWeight: 800, color: '#ffc800',
                letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '8px',
                textShadow: '0 0 36px rgba(255,200,0,0.35)',
              }}>afsyg.gay</h1>
              <p style={{
                fontSize: '13px', color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.02em', marginBottom: '40px',
              }}>
                Smart Twitch Moderation
              </p>

              {/* Единственное действие — вход через Google-почту */}
              <div style={{
                width: '100%', padding: '26px 24px', borderRadius: '18px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div ref={btnRef} style={{ display: 'flex', justifyContent: 'center', minHeight: '44px' }} />

                {!clientId && (
                  <div style={{ fontSize: '11px', color: '#ff7070', marginTop: '12px' }}>
                    ⚠ GOOGLE_CLIENT_ID не настроен на сервере
                  </div>
                )}

                {error && error !== 'not whitelisted' && (
                  <div style={{
                    marginTop: '14px', padding: '10px 14px', borderRadius: '10px',
                    background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
                    color: '#ff7070', fontSize: '12px',
                  }}>{error}</div>
                )}
              </div>

              <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', marginTop: '16px' }}>
                Вход по приглашению — почта должна быть в списке доступа
              </p>
            </motion.div>
          ) : (
            <motion.div key="blocked"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{
                width: '100%', maxWidth: '380px', padding: '36px 32px',
                borderRadius: '20px', textAlign: 'center',
                background: 'rgba(20,20,26,0.66)', border: '1px solid rgba(255,255,255,0.07)',
              }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 18px',
              }}>
                <ShieldAlert size={28} style={{ color: '#ff7070' }} />
              </div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: 'rgba(255,255,255,0.92)' }}>
                Доступ запрещён
              </h2>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '10px' }}>
                Этой почты нет в списке доступа:
              </p>
              <div style={{
                fontSize: '13px', fontWeight: 600, fontFamily: 'monospace',
                padding: '8px 14px', borderRadius: '10px', display: 'inline-block',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.85)', marginBottom: '16px',
              }}>{blockedEmail}</div>
              <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '22px', lineHeight: 1.5 }}>
                Напиши администратору, чтобы получить доступ
              </p>
              <button onClick={() => { setBlockedEmail(null); setError(null); window.google?.accounts.id.disableAutoSelect?.(); }}
                style={{
                  padding: '10px 20px', borderRadius: '11px', cursor: 'pointer',
                  background: 'rgba(255,200,0,0.1)', color: '#ffc800',
                  border: '1px solid rgba(255,200,0,0.25)', fontSize: '12px', fontWeight: 700,
                }}>
                Войти с другой почтой
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Footer />
    </div>
  );
}
