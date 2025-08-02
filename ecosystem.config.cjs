// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'jazz-proxy-server',
      script: './e2e/proxy-server.js',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/jazz-proxy-error.log',
      out_file: './logs/jazz-proxy-out.log',
      log_file: './logs/jazz-proxy-combined.log',
      time: true
    },
    {
      name: 'webhook-server',
      script: './e2e/proxy-webhook-server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/webhook-error.log',
      out_file: './logs/webhook-out.log',
      log_file: './logs/webhook-combined.log',
      time: true
    }
  ]
};