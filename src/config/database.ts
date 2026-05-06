import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  host:                   process.env.DB_HOST     || 'localhost',
  port:                   parseInt(process.env.DB_PORT || '5432', 10),
  database:               process.env.DB_NAME     || 'pupsj_hub',
  user:                   process.env.DB_USER     || 'postgres',
  password:               process.env.DB_PASSWORD || '',
  max:                    20,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
