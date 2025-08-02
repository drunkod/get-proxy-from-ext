// ecosystem.config.cjs
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
    }
  ]
};
