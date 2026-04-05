import chatRoutes from './chatRoutes.js';

import downloaderRoutes from './downloaderRoutes.js';
import bedrockWorldRoutes from './bedrockWorldRoutes.js';
import ratingRoutes from './ratingRoutes.js';
import streakRoutes from './streakRoutes.js';
import notificationRoutes from './notificationRoutes.js';

export function setupRoutes(app) {
    // Chat routes
    app.use('/api/chat', chatRoutes);
    
    // Downloader routes
    app.use('/api/download', downloaderRoutes);

    // Bedrock world viewer routes
    app.use('/api/bedrock-world', bedrockWorldRoutes);
    
    // Rating routes
    app.use('/api/ratings', ratingRoutes);
    
    // Streak routes
    app.use('/api/streaks', streakRoutes);
    
    // Notification routes
    app.use('/api/notifications', notificationRoutes);

    // TODO: Add other routes here

    // app.use('/api/config', configRoutes);
    // app.use('/api/pikamc', pikamcRoutes);
}
