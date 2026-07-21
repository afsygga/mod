import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';
import { recordDbPoolError } from '../utils/metrics';

class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (err) => { recordDbPoolError(); logger.error('PG pool error', err); });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    client.release();
  }

  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number | null }> {
    const start = Date.now();
    const result = await this.pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) logger.warn(`Slow query (${duration}ms): ${text}`);
    return result;
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /** Point-in-time pg pool stats for the health page (no query). */
  poolStats(): { total: number; idle: number; active: number; waiting: number } {
    const total = this.pool.totalCount;
    const idle = this.pool.idleCount;
    return { total, idle, active: total - idle, waiting: this.pool.waitingCount };
  }
}

export const db = new Database();
