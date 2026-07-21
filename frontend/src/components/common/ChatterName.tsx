import React from 'react';

/**
 * Chatter nickname that opens the Twitch viewer-card popout for that user in
 * the channel where they wrote — on MIDDLE-click (or ctrl/cmd/shift-click),
 * i.e. the browser's native "open in new tab" for an <a>. Plain left-click is
 * suppressed so it never hijacks row selection / expansion; the event still
 * bubbles so surrounding row handlers keep working.
 *
 * URL: https://www.twitch.tv/popout/<channel>/viewercard/<chatter>
 */
export function ChatterName({ channel, name, children, style, className }: {
  channel: string;
  name: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const url = `https://www.twitch.tv/popout/${encodeURIComponent((channel || '').toLowerCase())}/viewercard/${encodeURIComponent(name)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Средний клик — карточка зрителя на Twitch"
      onClick={e => {
        // Let ctrl/cmd/shift/middle open a new tab natively; block only plain left-click nav.
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) e.preventDefault();
      }}
      className={className}
      style={{ color: 'inherit', textDecoration: 'none', ...style }}
    >
      {children ?? name}
    </a>
  );
}
