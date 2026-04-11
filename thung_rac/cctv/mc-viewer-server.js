import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MCViewerServer {
    constructor(bot, port = 3001) {
        this.bot = bot;
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server);
        this.captureCallback = null;

        this.setupRoutes();
        this.setupSocket();
        this.setupBotEvents();
    }

    setupRoutes() {
        // Serve static files from the project's root for access to html/ and node_modules/ if needed
        this.app.use(express.static(path.join(__dirname, '../../..')));
    }

    setupSocket() {
        this.io.on('connection', (socket) => {
            console.log(`[Viewer-Server] New connection: ${socket.id}`);
            
            // Handle bot data coming from vna-cam-bot.js (acting as a standalone client)
            socket.on('bot:position', (pos) => {
                this.io.emit('position', pos);
            });

            socket.on('bot:chunk', (data) => {
                this.io.emit('chunk', data);
            });

            socket.on('bot:blockUpdate', (data) => {
                this.io.emit('blockUpdate', data);
            });

            // Receive captured frame from Playwright
            socket.on('frame-capture', (data) => {
                if (this.captureCallback) {
                    this.captureCallback(data);
                }
            });
        });
    }

    setupBotEvents() {
        if (!this.bot) return;

        this.bot.on('position', (pos) => {
            this.io.emit('position', pos);
        });

        this.bot.on('chunk', (data) => {
            this.io.emit('chunk', data);
        });

        this.bot.on('blockUpdate', (data) => {
            this.io.emit('blockUpdate', data);
        });
    }

    onCapture(callback) {
        this.captureCallback = callback;
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`[Viewer-Server] Running on http://localhost:${this.port}`);
        });
    }
}
