module.exports = {
  apps: [{
    name: 'trackqa',
    script: 'src/index.js',
    env: {
      PORT: 3000,
      NODE_ENV: 'production',
    },
    // Auto-restart on crash
    autorestart: true,
    max_restarts: 10,
    // Wait 1 second between restarts
    restart_delay: 1000,
    // Log config
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/tmp/trackqa-error.log',
    out_file: '/tmp/trackqa-out.log',
  }]
};
