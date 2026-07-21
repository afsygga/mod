import winston from 'winston';
import Transport from 'winston-transport';

// In-memory ring of the most recent warn/error log lines, surfaced on the
// admin System Health page so problems are visible before they hit chat.
export interface RecentLog { level: string; message: string; ts: number; }
export const recentIssues: RecentLog[] = [];

class RingTransport extends Transport {
  log(info: any, next: () => void) {
    const level = info[Symbol.for('level')] || info.level;
    if (level === 'error' || level === 'warn') {
      recentIssues.unshift({
        level,
        message: String(info.message ?? '').slice(0, 300),
        ts: Date.now(),
      });
      if (recentIssues.length > 60) recentIssues.pop();
    }
    next();
  }
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new RingTransport({ level: 'warn' }),
  ]
});
