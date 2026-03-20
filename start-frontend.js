import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, 'client', 'package.json'));
const { createServer } = require('vite');

const port = parseInt(process.env.PORT || '5174', 10);

const server = await createServer({
  root: path.join(__dirname, 'client'),
  configFile: path.join(__dirname, 'client', 'vite.config.js'),
  server: { host: true, port }
});

await server.listen();
server.printUrls();
