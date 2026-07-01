import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Radio, BarChart2, ShieldCheck, Wrench, X, Rocket } from 'lucide-react';

/**
 * One-time changelog shown on first visit after the 2.x overhaul.
 * Gated by localStorage key PATCHNOTES_KEY — shows once, never again.
 */
export const PATCHNOTES_KEY = 'patchnotes_seen_v2';

interface Section {
  icon: any;
  color: string;
  title: string;
  items: string[];
}

const SECTIONS: Section[] = [
  {
    icon: Radio, color: '#a070ff', title: 'Отслеживание стримов 24/7',
    items: [
      'Стримы отслеживаются на сервере постоянно — даже когда сайт никто не открыл',
      'Мгновенное определение начала и конца стрима через Twitch EventSub',
      'Завершённые стримы архивируются, графики сохраняются',
      'Вкладка «Стримы» вынесена наверх и доступна всем модераторам',
    ],
  },
  {
    icon: ShieldCheck, color: '#00c878', title: 'Живая модерация',
    items: [
      'Отслеживаются ВСЕ действия модераторов (баны, муты, разбаны, удаления) — из любого клиента: Chatterino, панель Twitch, другие боты',
      'Достаточно одному модератору войти через Twitch — ловятся действия всех',
      'Логи и статистика обновляются в реальном времени',
      'Отмена мута/бана в один клик прямо из логов',
      'Команда !g и алиасы !j / !cs / !dota для смены категории канала',
    ],
  },
  {
    icon: BarChart2, color: '#00e5cc', title: 'Аналитика',
    items: [
      'Профиль модератора: радар навыков, среднее время реакции, график активности за 30 дней',
      'Плавный график стрима с зумом колёсиком и живым обновлением',
      'Календарь активности и тепловая карта час × день',
      'Переработанный «Обзор» в админке: живая лента, онлайн, статус каналов',
      'Экспорт логов в .txt и журнал аудита админки',
    ],
  },
  {
    icon: Sparkles, color: '#ffc800', title: 'Интерфейс',
    items: [
      'Переработаны настройки — карточки, понятные слайдеры, плавающее сохранение',
      'Переработаны логи — колонка модератора, фильтры по дате, залипающая шапка',
      'Вход через Twitch OAuth и отдельная страница авторизации для стримеров',
      'Никнеймы Twitch с аватарками вместо почт',
      'Персональная причина мута для каждого модератора',
    ],
  },
  {
    icon: Wrench, color: '#ff9800', title: 'Мелкие фиксы',
    items: [
      'Устранены падения бэкенда (ReDoS в анти-спаме)',
      'Убрана бесконечная загрузка при F5',
      'Убран баг со свечением по краю карточек',
      'Улучшен детект спама: эмодзи, эмоуты, ротация, повтор темы',
      'Исправлено определение конца стрима и дубли в списке модераторов',
    ],
  },
];

export function PatchNotes({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', padding: '20px',
    }} onClick={onClose}>
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '560px', maxHeight: '86vh', overflowY: 'auto',
          background: 'rgba(18,18,24,0.98)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px', padding: '28px',
        }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '6px' }}>
          <div style={{
            width: '46px', height: '46px', borderRadius: '13px', flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(160,112,255,0.25), rgba(0,229,204,0.2))',
            border: '1px solid rgba(160,112,255,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c49dff',
          }}>
            <Rocket size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '19px', fontWeight: 800, color: '#fff' }}>Что нового</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Крупное обновление — версии 2.x</div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer',
            width: '32px', height: '32px', borderRadius: '9px', color: 'rgba(255,255,255,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '8px' }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '8px', flexShrink: 0,
                    background: `${s.color}1a`, border: `1px solid ${s.color}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color,
                  }}>
                    <Icon size={14} />
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>{s.title}</span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {s.items.map((it, j) => (
                    <li key={j} style={{
                      display: 'flex', gap: '9px', fontSize: '12.5px', lineHeight: 1.5,
                      color: 'rgba(255,255,255,0.65)', paddingLeft: '35px',
                    }}>
                      <span style={{ color: s.color, flexShrink: 0, marginLeft: '-16px' }}>•</span>
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <button onClick={onClose} style={{
          marginTop: '24px', width: '100%', padding: '13px', borderRadius: '12px', cursor: 'pointer',
          background: 'linear-gradient(135deg, rgba(160,112,255,0.9), rgba(140,90,255,0.9))',
          border: 'none', color: '#fff', fontSize: '14px', fontWeight: 700,
        }}>
          Понятно, погнали
        </button>
      </motion.div>
    </div>
  );
}
