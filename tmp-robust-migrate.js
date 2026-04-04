import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data.db');
const db = new Database(dbPath);

try {
    console.log('--- Robust Migration: forum_comments ---');
    const tableInfo = db.prepare('PRAGMA table_info(forum_comments)').all();
    const hasParentId = tableInfo.some(col => col.name === 'parent_id');

    if (!hasParentId) {
        console.log('parent_id MISSING. Starting replacement strategy...');
        
        db.transaction(() => {
            // 1. Rename old table
            db.prepare('ALTER TABLE forum_comments RENAME TO forum_comments_old').run();
            
            // 2. Create new table
            db.prepare(`
                CREATE TABLE forum_comments (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  post_id INTEGER,
                  user_id TEXT,
                  author_name TEXT,
                  author_avatar TEXT,
                  content TEXT,
                  parent_id INTEGER DEFAULT NULL,
                  created_at TEXT
                )
            `).run();
            
            // 3. Migrate data
            db.prepare(`
                INSERT INTO forum_comments (id, post_id, user_id, author_name, author_avatar, content, created_at)
                SELECT id, post_id, user_id, author_name, author_avatar, content, created_at
                FROM forum_comments_old
            `).run();
            
            // 4. Drop old table
            db.prepare('DROP TABLE forum_comments_old').run();
        })();
        
        console.log('✅ Table replacement completed successfully.');
    } else {
        console.log('✅ parent_id already exists. No action needed.');
    }

    // Verify
    const newInfo = db.prepare('PRAGMA table_info(forum_comments)').all();
    console.log('New Columns:', newInfo.map(c => c.name).join(', '));

} catch (e) {
    console.error('❌ Migration FAILED:', e);
} finally {
    db.close();
    process.exit(0);
}
