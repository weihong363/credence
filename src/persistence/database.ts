import Database from 'better-sqlite3';
import { migrations } from './migrations.js';

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  try {
    // SQLite table rebuilds require FK enforcement disabled outside the migration transaction.
    db.pragma('foreign_keys = OFF');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number;
      if (version > migrations.at(-1)!.version) throw new Error('UNSUPPORTED_SCHEMA');
      for (const migration of migrations.filter(item => item.version > version)) {
        db.exec(migration.sql);
        db.pragma(`user_version = ${migration.version}`);
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('MIGRATION_FOREIGN_KEY_MISMATCH');
    }).immediate();
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
