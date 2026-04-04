export default {
  apps: [{
    name: 'mcnote-web',
    script: 'server.js',
    instances: 'max', // Use all available CPU cores
    exec_mode: 'cluster', // Enable clustering mode
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Restart policy
    max_memory_restart: '1G',
    restart_delay: 4000,
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Monitoring
    watch: false,
    ignore_watch: ['node_modules', 'logs', 'mp3', 'video', 'youtube', 'photos'],
    // Environment variables
    env_file: '.env'
  }]
};
