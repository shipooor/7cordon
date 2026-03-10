import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let version = '0.0.0';
try {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version;
} catch { /* fallback version */ }

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    version,
    uptime: process.uptime(),
  });
});
