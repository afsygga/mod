import React, { useEffect, useState } from 'react';
import { Twitch, Check, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BroadcasterAuth() {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [login, setLogin] = useState('');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      setStatus('success');
      setLogin(params.get('login') || '');
      window.history.replaceState({}, '', '/broadcaster');
    } else if (params.get('error')) {
      setStatus('error');
      setErrMsg(params.get('error') || 'unknown');
      window.history.replaceState({}, '', '/broadcaster');
    }
  }, []);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0f', padding: '20px',
    }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        style={{
          width: '100%', maxWidth: '420px', padding: '36px', borderRadius: '20px',
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(20px)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px',
            background: 'rgba(145,70,255,0.15)', border: '1px solid rgba(145,70,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a070ff',
          }}>
            <Twitch size={20} />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
              Подключение стримера
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
              afsyg.gay — система модерации
            </div>
          </div>
        </div>

        {status === 'idle' && (
          <>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: '24px' }}>
              Нажми кнопку ниже и войди в свой Twitch аккаунт. Это позволит боту менять категорию канала по команде <span style={{ color: '#a070ff', fontFamily: 'monospace' }}>!g</span> в чате.
            </p>
            <a href="/backend/api/twitch-oauth/broadcaster-connect" style={{ textDecoration: 'none', display: 'block' }}>
              <button style={{
                width: '100%', padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
                background: 'rgba(145,70,255,0.18)', border: '1px solid rgba(145,70,255,0.35)',
                color: '#c49dff', fontSize: '14px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              }}>
                <Twitch size={16} />
                Войти через Twitch
              </button>
            </a>
          </>
        )}

        {status === 'success' && (
          <div style={{
            padding: '16px', borderRadius: '12px',
            background: 'rgba(0,200,120,0.08)', border: '1px solid rgba(0,200,120,0.2)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <Check size={18} style={{ color: '#00c878', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#00c878' }}>Успешно подключено!</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                Аккаунт: <span style={{ color: '#a070ff' }}>{login}</span>
              </div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div style={{
            padding: '16px', borderRadius: '12px',
            background: 'rgba(240,71,71,0.08)', border: '1px solid rgba(240,71,71,0.2)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <AlertTriangle size={18} style={{ color: '#ff7070', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#ff7070' }}>Ошибка</div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>{errMsg}</div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
