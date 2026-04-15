import express from 'express';
import db, { insertData } from '../modules/database.js';
import { getCloudUserRootName, revokeShareTokens } from './cloudRoutes.js';

const router = express.Router();

function normalizeForumAttachments(rawAttachments) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments
        .map((att) => ({
            name: String(att?.name || '').trim().slice(0, 200),
            token: String(att?.token || '').trim().slice(0, 200),
            path: String(att?.path || '').trim().slice(0, 600)
        }))
        .filter((att) => att.token && att.name);
}

const requireLogin = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Get all posts
router.get('/posts', (req, res) => {
    try {
        const userId = req.session.user?.id || null;
        const posts = db.prepare(`
            SELECT 
                p.*, 
                COALESCE(u.username, p.author_name) AS author_name, 
                COALESCE(u.avatar, p.author_avatar) AS author_avatar,
                (SELECT COUNT(*) FROM forum_likes WHERE post_id = p.id) AS like_count,
                (SELECT COUNT(*) FROM forum_comments WHERE post_id = p.id) AS comment_count,
                CASE WHEN ? IS NOT NULL AND EXISTS(SELECT 1 FROM forum_likes WHERE post_id = p.id AND user_id = ?) THEN 1 ELSE 0 END AS user_liked
            FROM forum_posts p
            LEFT JOIN players u ON p.user_id = u.id
            ORDER BY p.created_at DESC
        `).all(userId, userId);
        if (!Array.isArray(posts)) {
            return res.status(500).json({ error: 'Unexpected database response' });
        }
        // Parse attachments JSON
        posts.forEach(post => {
            if (post.attachments) {
                try {
                    post.attachments = normalizeForumAttachments(JSON.parse(post.attachments));
                } catch (e) {
                    post.attachments = [];
                }
            } else {
                post.attachments = [];
            }
        });
        res.json(posts);
    } catch (error) {
        console.error('Error fetching forum posts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create a post
router.post('/posts', requireLogin, async (req, res) => {
    const { title, content, attachments } = req.body;
    const user = req.session.user;

    if (!title?.trim() && !content?.trim() && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: 'Title, content or attachments are required' });
    }

    try {
        const normalizedAttachments = normalizeForumAttachments(attachments);
        const postId = await insertData('forum_posts', {
            user_id: user.id,
            author_name: user.username || user.global_name || 'Anonymous',
            author_avatar: user.avatar || null,
            title: String(title || '').slice(0, 200),
            content: String(content || '').slice(0, 20000),
            attachments: JSON.stringify(normalizedAttachments),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
        res.json({ success: true, postId });
    } catch (error) {
        console.error('Error creating forum post:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a post
router.delete('/posts/:id', requireLogin, async (req, res) => {
    const rawId = String(req.params.id || '').trim();
    const id = Number.parseInt(rawId, 10);
    const user = req.session.user;

    try {
        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: 'Invalid post id' });
        }

        const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(id);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        // Check ownership (or admin status)
        if (post.user_id !== user.id) {
            // Check if user is admin (whitelist)
            const isAdmin = db.prepare('SELECT * FROM whitelist WHERE admin_id = ?').get(user.id);
            if (!isAdmin) {
                return res.status(403).json({ error: 'Forbidden' });
            }
        }

        let postAttachments = [];
        if (post.attachments) {
            try {
                postAttachments = JSON.parse(post.attachments);
            } catch (_error) {
                postAttachments = [];
            }
        }

        const tokensInPost = Array.from(new Set(
            (Array.isArray(postAttachments) ? postAttachments : [])
                .map((att) => String(att?.token || '').trim())
                .filter(Boolean)
        ));

        const deleteTx = db.transaction((postId) => {
            db.prepare('DELETE FROM forum_likes WHERE post_id = ?').run(postId);
            db.prepare('DELETE FROM forum_comments WHERE post_id = ?').run(postId);
            db.prepare('DELETE FROM forum_posts WHERE id = ?').run(postId);
        });
        deleteTx(id);

        const referencedTokens = new Set();
        if (tokensInPost.length > 0) {
            const remainingPosts = db.prepare('SELECT attachments FROM forum_posts').all();
            for (const row of remainingPosts) {
                if (!row?.attachments) continue;
                try {
                    const parsed = normalizeForumAttachments(JSON.parse(row.attachments));
                    for (const att of parsed) {
                        const token = String(att?.token || '').trim();
                        if (token) referencedTokens.add(token);
                    }
                } catch (_error) {
                    // ignore malformed JSON rows
                }
            }
        }

        const tokensToRevoke = tokensInPost.filter((token) => !referencedTokens.has(token));

        let revokedShares = 0;
        if (tokensToRevoke.length > 0) {
            const ownerRootName = getCloudUserRootName(post.user_id);
            try {
                const revokeResult = await revokeShareTokens(tokensToRevoke, {
                    ownerRootName,
                    revokedReason: 'forum_post_deleted',
                    revokedBy: user.id
                });
                revokedShares = Number(revokeResult?.revoked || 0);
            } catch (_error) {
                // Best-effort only; post deletion should still succeed.
            }
        }

        return res.json({ success: true, revokedShares });
    } catch (error) {
        console.error('Error deleting forum post:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Toggle Like
router.post('/posts/:id/like', requireLogin, (req, res) => {
    const { id } = req.params;
    const userId = req.session.user.id;
    const now = new Date().toISOString();

    try {
        const post = db.prepare('SELECT 1 FROM forum_posts WHERE id = ?').get(id);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const existing = db.prepare('SELECT 1 FROM forum_likes WHERE post_id = ? AND user_id = ?').get(id, userId);
        if (existing) {
            db.prepare('DELETE FROM forum_likes WHERE post_id = ? AND user_id = ?').run(id, userId);
            return res.json({ success: true, liked: false });
        } else {
            db.prepare('INSERT INTO forum_likes (post_id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, now);
            return res.json({ success: true, liked: true });
        }
    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get comments for a post
router.get('/posts/:id/comments', (req, res) => {
    const { id } = req.params;
    try {
        const post = db.prepare('SELECT 1 FROM forum_posts WHERE id = ?').get(id);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const comments = db.prepare(`
            SELECT 
                c.*, u.username as current_name, u.avatar as current_avatar
            FROM forum_comments c
            LEFT JOIN players u ON c.user_id = u.id
            WHERE c.post_id = ?
            ORDER BY c.created_at ASC
        `).all(id);

        const formatted = comments.map(c => ({
            ...c,
            author_name: c.current_name || c.author_name,
            author_avatar: c.current_avatar || c.author_avatar
        }));

        res.json(formatted);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a comment
router.post('/posts/:id/comments', requireLogin, async (req, res) => {
    const { id } = req.params;
    const { content, parent_id } = req.body;
    const user = req.session.user;

    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Comment content is required' });
    }

    try {
        const post = db.prepare('SELECT 1 FROM forum_posts WHERE id = ?').get(id);
        if (!post) {
            return res.status(404).json({ error: 'Post not found' });
        }

        const rawParentId = parent_id === undefined || parent_id === null ? '' : String(parent_id).trim();
        const parsedParentId = rawParentId === '' ? null : Number.parseInt(rawParentId, 10);
        const parentId = Number.isInteger(parsedParentId) ? parsedParentId : null;

        const commentId = await insertData('forum_comments', {
            post_id: id,
            user_id: user.id,
            author_name: user.username,
            author_avatar: user.avatar,
            content: content.trim(),
            parent_id: parentId,
            created_at: new Date().toISOString()
        });
        res.json({ success: true, commentId });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
