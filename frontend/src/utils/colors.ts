const PALETTE = ['#9147ff','#00b37e','#faa61a','#5865f2','#17c4c4','#e91e8c','#ff6b6b','#4ecdc4'];

export function getUserColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h},55%,62%)`;
}

export function getChannelColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
}
