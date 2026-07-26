import React, { useState, useEffect } from 'react';
import { Monitor, Trash2, ShieldCheck } from 'lucide-react';
import { api } from '../../hooks/useApi';
import { Lang } from '../../utils/i18n';

interface Session {
  id: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  current: boolean;
}

interface Props {
  lang: Lang;
}

/** Грубый, но читаемый разбор user-agent → "Chrome · Windows". */
function prettyAgent(ua: string | null, lang: Lang): string {
  if (!ua) return lang === 'ru' ? 'Неизвестное устройство' : 'Unknown device';
  const browser =
    /edg/i.test(ua) ? 'Edge' :
    /opr|opera/i.test(ua) ? 'Opera' :
    /firefox/i.test(ua) ? 'Firefox' :
    /chrome|crios/i.test(ua) ? 'Chrome' :
    /safari/i.test(ua) ? 'Safari' : (lang === 'ru' ? 'Браузер' : 'Browser');
  const os =
    /windows/i.test(ua) ? 'Windows' :
    /android/i.test(ua) ? 'Android' :
    /iphone|ipad|ios/i.test(ua) ? 'iOS' :
    /mac os|macintosh/i.test(ua) ? 'macOS' :
    /linux/i.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export function SessionsSettings({ lang }: Props) {
  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.get<Session[]>('/api/auth/sessions').then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const revoke = async (id: string) => {
    await api.delete(`/api/auth/sessions/${id}`).catch(console.error);
    load();
  };

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  };

  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {lang === 'ru'
          ? 'Активные входы в твой аккаунт. Не узнаёшь устройство — отзови сессию, и его токен перестанет работать сразу.'
          : 'Active logins to your account. Don\'t recognise a device — revoke it and its token stops working immediately.'}
      </div>

      <div style={{ paddingTop: '12px' }}>
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', padding: '10px 0' }}>
            {lang === 'ru' ? 'Загрузка...' : 'Loading...'}
          </div>
        ) : items.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', padding: '12px 0', textAlign: 'center' }}>
            {lang === 'ru' ? 'Нет активных сессий' : 'No active sessions'}
          </div>
        ) : items.map(s => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}>
            <Monitor size={16} color={s.current ? '#00c878' : 'rgba(255,255,255,0.45)'} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                  {prettyAgent(s.user_agent, lang)}
                </span>
                {s.current && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    fontSize: '9px', fontWeight: 700, color: '#00c878',
                    background: 'rgba(0,200,120,0.12)', padding: '2px 6px', borderRadius: '6px',
                  }}>
                    <ShieldCheck size={9} />{lang === 'ru' ? 'ЭТО УСТРОЙСТВО' : 'THIS DEVICE'}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '3px' }}>
                {lang === 'ru' ? 'Вход: ' : 'Signed in: '}{fmt(s.created_at)}
                {' · '}{lang === 'ru' ? 'до ' : 'expires '}{fmt(s.expires_at)}
              </div>
            </div>
            {!s.current && (
              <button onClick={() => revoke(s.id)} title={lang === 'ru' ? 'Отозвать' : 'Revoke'} style={{
                padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
                background: 'rgba(240,71,71,0.08)', color: '#ff7070', border: 'none',
                display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 600, flexShrink: 0,
              }}>
                <Trash2 size={11} />{lang === 'ru' ? 'Отозвать' : 'Revoke'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
