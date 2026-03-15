import { initDb, getDb } from './server/db/index.js';
initDb();
const db = getDb();
db.exec(`
CREATE TABLE IF NOT EXISTS processed_webhooks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
`);
console.log('Migration done');
