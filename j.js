import 'dotenv/config';
import bedrock from 'bedrock-protocol';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import io from 'socket.io-client';

/**
 * VNA Cam Bot with Microsoft Authentication
 * Standalone version that connects to the Web Server to push visuals
 */
export class VNACamBot extends EventEmitter {
    constructor(options = {}) {
        super();
        this.host = options.host || process.env.MINECRAFT_HOST || 'vna.vanhmcpe.top';
        this.port = parseInt(options.port || process.env.MINECRAFT_PORT) || 25003;
        this.version = options.version || '1.26.0'; // Updated as per user
        
        // Viewer Server URL (for pushing data to the web)
        this.viewerUrl = options.viewerUrl || 'http://localhost:3001';
        this.socket = null;
        
        // Auth options
        this.email = process.env.MS_EMAIL || '';
        this.password = process.env.MS_PASSWORD || '';
        
        this.profilesFolder = path.join(process.cwd(), '.mc-auth');
        if (!fs.existsSync(this.profilesFolder)) {
            fs.mkdirSync(this.profilesFolder, { recursive: true });
        }

        this.client = null;
        this.connected = false;
        this.position = { x: 0, y: 0, z: 0 };
    }

    /**
     * Connect to the Web Server's Viewer Component
     */
    connectToWeb() {
        console.log(`[VNA-Bot] Connecting to Web Viewer at ${this.viewerUrl}...`);
        this.socket = io(this.viewerUrl);
        
        this.socket.on('connect', () => {
            console.log('✅ [VNA-Bot] Connected to Web Viewer server!');
            this.socket.emit('bot:status', { connected: true });
        });

        this.socket.on('disconnect', () => {
            console.log('⚠️  [VNA-Bot] Disconnected from Web Viewer server.');
        });
    }

    start() {
        this.connectToWeb();
        console.log(`[VNA-Bot] Initializing Minecraft connection to ${this.host}:${this.port}...`);
        
        const clientOptions = {
            host: this.host,
            port: this.port,
            version: this.version,
            profilesFolder: this.profilesFolder,
            onMsaCode: (data) => {
                console.log('--------------------------------------------------');
                console.log('🔐 MICROSOFT AUTHENTICATION REQUIRED');
                console.log(`1. Visit: ${data.verification_uri}`);
                console.log(`2. Enter code: ${data.user_code}`);
                console.log('--------------------------------------------------');
                
                // Automatically open the browser
                if (process.platform === 'win32') {
                    exec(`start ${data.verification_uri}`);
                    console.log('🌐 Browser opened automatically. Please sign in.');
                }
                
                this.emit('msaCode', data);
            }
        };

        if (this.email && this.password) {
            console.log(`[VNA-Bot] Attempting direct login with email: ${this.email}`);
            clientOptions.username = this.email;
            clientOptions.password = this.password;
        } else {
            console.log(`[VNA-Bot] Using Device Code Flow (No MS_EMAIL/MS_PASSWORD found in .env)`);
            clientOptions.username = 'VNA_LiveCam';
        }

        try {
            this.client = bedrock.createClient(clientOptions);

            this.client.on('join', () => {
                this.connected = true;
                console.log('✅ [VNA-Bot] Joined Minecraft server successfully!');
                if (this.socket) {
                    this.socket.emit('bot:status', { connected: true, username: this.username });
                    this.socket.emit('bot:position', this.position);
                }
                this.emit('connected');
            });

            this.client.on('error', (err) => {
                console.error('❌ [VNA-Bot] Minecraft Error:', err.message || err);
                if (this.socket) this.socket.emit('bot:error', { message: err.message });
                this.emit('error', err);
            });

            this.client.on('disconnect', (reason) => {
                this.connected = false;
                console.log('⚠️  [VNA-Bot] Disconnected from Minecraft:', reason);
                if (this.socket) this.socket.emit('bot:status', { connected: false });
                this.emit('disconnected', reason);
            });

            this.client.on('move_player', (packet) => {
                this.position = packet.position;
                if (this.socket) {
                    console.log(`[VNA-Bot] Moving to: ${Math.round(this.position.x)}, ${Math.round(this.position.y)}, ${Math.round(this.position.z)}`);
                    this.socket.emit('bot:position', this.position);
                }
                this.emit('position', this.position);
            });

            this.client.on('level_chunk', (packet) => {
                if (this.socket) this.socket.emit('bot:chunk', packet);
                this.emit('chunk', packet);
            });

            this.client.on('update_block', (packet) => {
                if (this.socket) this.socket.emit('bot:blockUpdate', packet);
                this.emit('blockUpdate', packet);
            });

        } catch (error) {
            console.error('❌ [VNA-Bot] Fatal Error:', error);
        }
    }

    stop() {
        if (this.client) {
            this.client.disconnect('Bot stopped');
        }
        if (this.socket) {
            this.socket.disconnect();
        }
    }
}

// Run as a standalone process
const bot = new VNACamBot();
bot.start();
