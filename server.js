const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Erreur du serveur');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      }
    });
  } else {
    res.writeHead(404);
    res.end('Page non trouvée');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur web + WebSocket démarré sur le port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  console.log('👤 Nouvel utilisateur connecté');

  socket.on('message', (data) => {
    const message = data.toString();
    console.log('📩', message);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  socket.on('close', () => {
    console.log('👋 Utilisateur déconnecté');
  });
});
