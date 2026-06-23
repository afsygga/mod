import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { SuccessAnimation } from './SuccessAnimation';
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
    fetch(`${BASE}/api/auth/config`).then(r => r.json()).then(d => setClientId(d.google_client_id)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) return;
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
        shape: 'rectangular',
        text: 'continue_with',
        logo_alignment: 'left',
      });
    }
  }, [clientId, loginWithGoogle]);

  return (
    <div style={{
      minHeight: '100vh', overflow: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px', position: 'relative',
      }}>
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="glass-card"
        style={{
          width: '100%', maxWidth: '420px', padding: '36px 32px',
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>

        {/* Logo */}
        <img src="/lightning.gif" alt=""
          style={{
            display: 'block', margin: '0 auto 16px',
            width: '60px', height: '60px', objectFit: 'contain',
            filter: 'drop-shadow(0 0 24px rgba(255,200,0,0.45))',
          }} />

        <h1 style={{
          fontSize: '24px', fontWeight: 700, color: '#ffc800',
          letterSpacing: '-0.01em', marginBottom: '6px',
          textShadow: '0 0 30px rgba(255,200,0,0.35)',
        }}>afsyg.gay</h1>
        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)', marginBottom: '28px' }}>
          Smart Twitch Moderation
        </p>

        {!blockedEmail && (
          <>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '16px', lineHeight: 1.5 }}>
              Войдите через Google аккаунт<br />
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>Доступ только для whitelisted email</span>
            </div>

            <div ref={btnRef} style={{ display: 'flex', justifyContent: 'center', minHeight: '44px' }} />

            {!clientId && (
              <div style={{ fontSize: '11px', color: '#ff7070', marginTop: '14px' }}>
                ⚠ GOOGLE_CLIENT_ID не настроен на сервере
              </div>
            )}

            {error && error !== 'not whitelisted' && (
              <div style={{
                marginTop: '16px', padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
                color: '#ff7070', fontSize: '12px',
              }}>{error}</div>
            )}
          </>
        )}

        {blockedEmail && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 18px',
            }}>
              <ShieldAlert size={28} style={{ color: '#ff7070' }} />
            </div>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'rgba(255,255,255,0.92)' }}>
              Доступ запрещён
            </h2>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
              Ваш email не в списке доступа:
            </p>
            <div style={{
              fontSize: '13px', fontWeight: 600,
              padding: '8px 14px', borderRadius: '10px', display: 'inline-block',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)',
              marginBottom: '18px',
            }}>{blockedEmail}</div>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '20px', lineHeight: 1.5 }}>
              Свяжитесь с администратором чтобы получить доступ
            </p>
            <button onClick={() => { setBlockedEmail(null); setError(null); window.google?.accounts.id.disableAutoSelect?.(); }}
              style={{
                padding: '9px 18px', borderRadius: '10px', cursor: 'pointer',
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.1)', fontSize: '12px', fontWeight: 600,
              }}>
              Попробовать другой аккаунт
            </button>
          </motion.div>
        )}
      </motion.div>
      </div>
      <Footer />
    </div>
  );
}
