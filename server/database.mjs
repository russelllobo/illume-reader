import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
pg.types.setTypeParser(1184, value => new Date(value).toISOString());
pg.types.setTypeParser(1114, value => new Date(value + 'Z').toISOString());
pg.types.setTypeParser(1082, value => value);
pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Database integer exceeds the supported range');
  return number;
});
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export async function transaction(operation) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const result = await operation(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}
