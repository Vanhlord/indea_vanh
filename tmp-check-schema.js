import db from './src/modules/database.js';

try {
    const tableInfo = db.prepare('PRAGMA table_info(forum_comments)').all();
    console.log('Schema for forum_comments:');
    console.log(tableInfo);
    
    // Check if we can actually insert a test row with parent_id
    // db.prepare('INSERT INTO forum_comments (post_id, user_id, author_name, author_avatar, content, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(0, 'test', 'test', 'test', 'test', null, 'test');
    // console.log('Successfully inserted a test row with parent_id=null');
} catch (e) {
    console.error('Error checking schema:', e);
} finally {
    process.exit(0);
}
