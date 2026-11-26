import { execSync } from 'child_process';
import path from 'path';
import { testDatabaseUrl } from './test-env';

// Rebuilds the TEST database by replaying every migration (the same SQL production gets, including
// the trip-number sequence) and loads the seed and the demo company, so every run starts from the
// same known data.
// Refuses to touch any database whose name doesn't end in "_test".
export default async function globalSetup() {
  const url = testDatabaseUrl();
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset "${dbName}": the e2e database name must end with "_test".`);

  const cwd = path.join(__dirname, '..', 'backend');
  const env = { ...process.env, DATABASE_URL: url };
  console.log(`\n[e2e] Rebuilding test database "${dbName}" ...`);
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd, env, stdio: 'pipe' });
  execSync('npx ts-node prisma/seed.ts', { cwd, env, stdio: 'pipe' });
  execSync('npx ts-node prisma/demo/index.ts load', { cwd, env, stdio: 'pipe' });
  console.log('[e2e] Test database ready.\n');
}
