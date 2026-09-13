import React, { useEffect, useState } from 'react';
import { Twitch, Check, AlertTriangle, Heart, Lock, Eye } from 'lucide-react';
import { motion } from 'framer-motion';

// Человеческая расшифровка кодов ошибок followers-колбэка
const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Ты отменил авторизацию на Twitch. Если передумал — просто нажми кнопку ещё раз.',
  invalid_state: 'Ссылка авторизации устарела (она живёт 10 минут). Нажми кнопку ещё раз.',
  missing_scopes: 'Twitch не выдал нужные права. Попробуй ещё раз и подтверди оба разрешения.',
  token_exchange_failed: 'Не удалось обменять код авторизации на токен. Попробуй ещё раз.',
  incomplete_tokens: 'Twitch вернул неполный ответ. Попробуй ещё раз.',
  user_fetch_failed: 'Не удалось получить данные твоего аккаунта. Попробуй ещё раз.',
  no_user_data: 'Не удалось получить данные твоего аккаунта. Попробуй ещё раз.',
  persist_failed: 'Не удалось сохранить авторизацию. Попробуй ещё раз.',
  missing_code: 'Twitch не вернул код авторизации. Попробуй ещё раз.',
  not_configured: 'Сервис не настроен. Напиши админу.',
  callback_failed: 'Что-то пошло не так. Попробуй ещё раз.',
};

const CONNECT_URL = '/backend/api/twitch-oauth/followers-connect';

const Code = ({ children }: { children: React.ReactNode }) => (
  <code style={{
    fontFamily: 'monospace', fontSize: '12px', padding: '1px 6px', borderRadius: '5px',
    background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)',
  }}>{children}</code>
);

export default function FollowersShare() {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [login, setLogin] = useState('');
  const [channels, setChannels] = useState(0);
  const [errCode, setErrCode] = useState('');
  const [errScopes, setErrScopes] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      setStatus('success');
      setLogin(params.get('login') || '');
      setChannels(Number(params.get('channels') || 0));
      window.history.replaceState({}, '', '/followers');
    } else if (params.get('error')) {
      setStatus('error');
      setErrCode(params.get('error') || 'unknown');
      setErrScopes(params.get('scopes') || '');
      window.history.replaceState({}, '', '/followers');
    }
  }, []);

  const button = (label: string) => (
    <a href={CONNECT_URL} style={{ textDecoration: 'none', display: 'block' }}>
      <motion.div
        whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          padding: '13px 18px', borderRadius: '12px', cursor: 'pointer',
          background: 'linear-gradient(135deg, #9146ff, #772ce8)', color: '#fff',
          fontSize: '14px', fontWeight: 600, boxShadow: '0 8px 24px rgba(145,70,255,0.28)',
        }}>
        <Twitch size={17} /> {label}
      </motion.div>
    </a>
  );

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#050508', padding: '20px',
    }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        style={{
          width: '100%', maxWidth: '440px', padding: '32px', borderRadius: '20px',
          background: 'rgba(20,20,26,0.66)', border: '1px solid rgba(255,255,255,0.07)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px',
            background: 'rgba(255,90,120,0.14)', border: '1px solid rgba(255,90,120,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b8a',
          }}>
            <Heart size={20} />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
              Даты фоллоу для aFserinno
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
              afsyg.gay — для модераторов
            </div>
          </div>
        </div>

        {status === 'idle' && (
          <>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, marginBottom: '14px' }}>
              Twitch показывает, когда человек зафолловил канал, только его
              <b style={{ color: 'rgba(255,255,255,0.85)' }}> модераторам</b>. Если ты модератор,
              один вход здесь — и карточки пользователей в aFserinno снова показывают
              «Following since» в твоих каналах.
            </p>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px',
              padding: '12px 14px', borderRadius: '12px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
              fontSize: '12.5px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5,
            }}>
              <div style={{ display: 'flex', gap: '9px' }}><Eye size={15} style={{ flexShrink: 0, marginTop: '1px', color: '#ff6b8a' }} />
                <span>Только чтение: <Code>moderator:read:followers</Code> и <Code>user:read:moderated_channels</Code>. Ничего писать, банить или менять от твоего имени нельзя.</span></div>
              <div style={{ display: 'flex', gap: '9px' }}><Lock size={15} style={{ flexShrink: 0, marginTop: '1px', color: '#ff6b8a' }} />
                <span>Работает во всех каналах, где ты мод, пока ты там мод. Отозвать можно в настройках Twitch → Подключения.</span></div>
            </div>
            {button('Войти через Twitch')}
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '12px',
              background: 'rgba(60,200,120,0.1)', border: '1px solid rgba(60,200,120,0.3)', marginBottom: '16px',
            }}>
              <Check size={18} style={{ color: '#4ade80' }} />
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                Готово, <b>{login}</b>. Каналов с твоими правами: <b>{channels}</b>.
              </div>
            </div>
            <p style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: '18px' }}>
              Список каналов обновляется раз в час. Если тебя замодят где-то ещё, оно подхватится само.
            </p>
            {button('Войти другим аккаунтом')}
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', borderRadius: '12px',
              background: 'rgba(255,90,90,0.08)', border: '1px solid rgba(255,90,90,0.28)', marginBottom: '16px',
            }}>
              <AlertTriangle size={18} style={{ color: '#ff7b7b', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
                {ERROR_TEXT[errCode] || `Ошибка: ${errCode}`}
                {errScopes && <div style={{ marginTop: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Не хватает: <Code>{errScopes}</Code></div>}
              </div>
            </div>
            {button('Попробовать ещё раз')}
          </>
        )}
      </motion.div>
    </div>
  );
}
