import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, BarChart2, ShieldCheck, Wrench, X, Rocket, Activity, Gamepad2 } from 'lucide-react';

/**
 * Changelog modal. Shown once per key — bump PATCHNOTES_KEY when the contents
 * change so returning users see the new notes; the header button reopens it any
 * time regardless.
 */
export const PATCHNOTES_KEY = 'patchnotes_seen_v249';

interface Section {
  icon: any;
  color: string;
  title: string;
  items: string[];
}

const SECTIONS: Section[] = [
  {
    icon: Gamepad2, color: '#a070ff', title: 'Категории стрима',
    items: [
      'Steam → Twitch: стример запускает игру, категория на канале меняется сама. Настраивается в админке, включается и выключается по желанию',
      'Смены категории видны на графике стрима — полоса под ним и маркеры в моменты переключения',
      'Категория показывается в подсказке графика вместе с сообщениями и спамом',
      'Команда !g стала надёжнее: перебирает все живые авторизации стримера, а не сдаётся на первой мёртвой',
    ],
  },
  {
    icon: ShieldCheck, color: '#00c878', title: 'Модерация',
    items: [
      'Метки Twitch о подозрительных аккаунтах (обход бана, бан в связанных каналах) подмешиваются в спам-скор — движок узнаёт то, чего из текста не выведешь',
      'Ложную метку можно снять в один клик прямо в очереди, и она не вернётся после следующего сообщения',
      'Pile-on: когда несколько модераторов бьют одного спамера, действие каждого засчитывается в его статистику, но в логах остаётся одной строкой',
      'Повторные действия по уже наказанному юзеру больше не засоряют логи',
      'Разбан в один клик прямо из логов',
      'Средний клик по нику чаттера открывает карточку зрителя Twitch',
    ],
  },
  {
    icon: BarChart2, color: '#00e5cc', title: 'Логи и аналитика',
    items: [
      'Поиск в логах теперь находит и по нику модератора — раньше искались только те, КОГО наказали',
      'Фильтр по конкретному модератору рядом с фильтром каналов',
      'Раскрытие строки лога показывает, что юзер писал перед наказанием, и кто ещё по нему отработал',
      'Вкладка «Модераторы» в админке с профилем и личным журналом действий',
      'Фильтр статистики по конкретному дню с переходом вперёд-назад',
      'Счётчики в логах считают все записи, а не первые 500',
      'Сравнение двух стримов наложением и детализация по любой минуте',
      'Тепловая карта час × день, экспорт логов в .txt, журнал аудита админки',
      'Цвет модератора на графиках закреплён за человеком, а не за позицией в списке',
    ],
  },
  {
    icon: Wrench, color: '#ff9800', title: 'Надёжность',
    items: [
      'Полностью переработан цикл OAuth: токен считается обновлённым только после подтверждённой записи, гонки больше не затирают свежую пару',
      'Протухшая авторизация переживает перезапуск и честно показывает баннер вместо тихой поломки',
      'Почасовая проверка всех авторизаций с автоматическим обновлением протухших',
      'Исправлен белый экран после деплоя',
      'Исправлена двойная обработка сообщений, из-за которой возникал ложный спам',
      'Корректное завершение работы — стримы больше не залипают в статусе LIVE',
    ],
  },
  {
    icon: Activity, color: '#5b9eff', title: 'Наблюдаемость',
    items: [
      'Вкладка «Здоровье» в админке: состояние бота, каналов, подписок и токенов на одном экране',
      'Метрики Prometheus на /metrics и отдельная проверка готовности /ready',
      'Последние ошибки бэкенда видны прямо в админке, без доступа к серверу',
    ],
  },
  {
    icon: Sparkles, color: '#ffc800', title: 'Интерфейс',
    items: [
      'Вкладка Steam в админке собрана заново: плитки статуса, живое состояние каждого канала, понятные подсказки',
      'Переработан экран входа — проще, чище, без мельканий при загрузке',
      'Страница /broadcaster переписана под стримеров: понятно, что и зачем нажимать',
      'Настройки — карточки разделов, боковая навигация, плавающее сохранение',
      'Спокойные компактные карточки в очереди модерации',
      'Иконки обновления наконец крутятся: анимация была объявлена, но не существовала',
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
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>Версии 2.20 — 2.49</div>
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
