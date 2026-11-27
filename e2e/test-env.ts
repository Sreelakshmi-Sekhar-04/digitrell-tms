import fs from 'fs';
import path from 'path';

// Override with E2E_API_PORT / E2E_WEB_PORT when 4100/3100 are busy (e.g. the Playwright VS Code extension holds them).
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
export const API_URL = `http://localhost:${API_PORT}/api`;

/**
 * Test database URL: E2E_DATABASE_URL if set, otherwise the backend's DATABASE_URL with "_test"
 * appended to the database name. It is never the main database.
 */
export function testDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const envFile = path.join(__dirname, '..', 'backend', '.env');
  const match = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!match) throw new Error(`DATABASE_URL not found in ${envFile}`);
  const url = new URL(match[1]);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName) throw new Error('DATABASE_URL has no database name');
  url.pathname = `/${dbName.endsWith('_test') ? dbName : `${dbName}_test`}`;
  return url.toString();
}
