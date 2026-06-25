const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BACKUP_DIR = path.join(__dirname, 'backups');

// Sicherstellen, dass das Backup-Verzeichnis existiert
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS-Header für alle Anfragen setzen (erlaubt auch Aufrufe von file:// URLs)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight-OPTIONS-Request abfangen
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1) API-Route für das automatische Backup
  if (req.method === 'POST' && req.url === '/api/backup') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        // Dateiname mit aktuellem Zeitstempel generieren
        const d = new Date();
        const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
        const fileName = `archive_backup_${stamp}.json`;
        const filePath = path.join(BACKUP_DIR, fileName);
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[Backup] Sicherungskopie des Archivs erstellt: ${filePath}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, file: fileName }));
      } catch (err) {
        console.error('[Backup-Fehler]', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 2) Statische Dateien der Kita-Portfolio-App ausliefern
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  
  // Sicherheits-Check: Verhindern, dass aus dem Verzeichnis ausgebrochen wird
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server-Fehler: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`  Kita-Portfolio-Studio Backup-Server aktiv!`);
  console.log(`  ---------------------------------------------------------`);
  console.log(`  -> URL im Browser:  http://localhost:${PORT}`);
  console.log(`  -> Backup-Ordner:   ${BACKUP_DIR}`);
  console.log(`===========================================================`);
});
