import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(__dirname, '../hisab-data.json');

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  plugins: [
    {
      name: 'local-file-storage',
      configureServer(server) {
        // API endpoint to read and write hisab-data.json on PC hard drive
        server.middlewares.use((req, res, next) => {
          const url = req.url ? req.url.split('?')[0] : '';

          if (url === '/api/data') {
            if (req.method === 'GET') {
              if (fs.existsSync(DATA_FILE)) {
                try {
                  const data = fs.readFileSync(DATA_FILE, 'utf8');
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(data);
                } catch (e) {
                  res.statusCode = 500;
                  return res.end(JSON.stringify({ error: 'Failed to read data file' }));
                }
              } else {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'No data file found on disk' }));
              }
            }

            if (req.method === 'POST') {
              let body = '';
              req.on('data', chunk => {
                body += chunk;
              });
              req.on('end', () => {
                try {
                  // Verify valid JSON
                  JSON.parse(body);
                  fs.writeFileSync(DATA_FILE, body, 'utf8');
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify({ 
                    success: true, 
                    path: DATA_FILE, 
                    savedAt: new Date().toISOString() 
                  }));
                } catch (err: any) {
                  res.statusCode = 400;
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify({ error: 'Invalid JSON payload: ' + err.message }));
                }
              });
              return;
            }
          }

          if (url === '/api/status' && req.method === 'GET') {
            const exists = fs.existsSync(DATA_FILE);
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
              ok: true,
              path: DATA_FILE,
              exists,
              sizeBytes: exists ? fs.statSync(DATA_FILE).size : 0,
              lastModified: exists ? fs.statSync(DATA_FILE).mtime.toISOString() : null
            }));
          }

          next();
        });
      }
    }
  ]
});
