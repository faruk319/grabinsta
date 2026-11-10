'use strict';

// GrabInsta entry point. Hostinger's managed Node.js app runs `npm start`,
// which runs this file. It must read PORT from the environment and bind
// to 0.0.0.0 — never hard-code a port, and never put the app in public_html.
const { createApp } = require('./src/app');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '0.0.0.0';

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`GrabInsta listening on http://${HOST}:${PORT} (PORT=${PORT})`);
});

server.on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});

// Graceful shutdown so Hostinger restarts do not leave sockets hanging.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
