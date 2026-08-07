import { createApp } from './app.ts';
import { env } from './config/env.ts';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`API слушает http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
