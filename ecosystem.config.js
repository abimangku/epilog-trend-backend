module.exports = {
  apps: [
    {
      name: 'trend-watcher',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      restart_delay: 1000,
      max_restarts: 10,       // Stop restarting after 10 unstable restarts (exits before min_uptime)
      min_uptime: '15000',    // 15s — exit before this threshold counts as an unstable restart
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Log files — PM2 manages rotation
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
