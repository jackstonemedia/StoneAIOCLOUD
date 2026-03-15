import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { logger } from '../lib/logger.js';

let db: Database.Database;

export function initDb() {
  const dbPath = process.env.DATABASE_URL || './stoneaio.db';
  db = new Database(dbPath);
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  logger.info(`Database initialized at ${dbPath}`);

  // Run migrations / schema
  const schemaPath = path.join(process.cwd(), 'server', 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    logger.info('Database schema applied');
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

// If run directly, execute migrations
if (process.argv[1] === new URL(import.meta.url).pathname) {
  initDb();
  logger.info('Migrations completed successfully.');
  process.exit(0);
}
