import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
app.server.listen(port, host, () => console.log(`Zinlo server: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
