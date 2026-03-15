import { initDb, getDb } from './server/db/index.js';
initDb();
const db = getDb();
db.exec('DROP TABLE IF EXISTS agent_runs; DROP TABLE IF EXISTS agents;');
initDb();
console.log('Done');
