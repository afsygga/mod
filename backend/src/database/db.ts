import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';

class Database {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (err) => logger.error('PG pool error', err));
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
}

export const db = new Database();
