const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Historique global (stocké en mémoire)
let messagesHistory = [];

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
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  console.log('👤 Nouvel utilisateur connecté');

  // Envoyer l'historique complet au nouvel utilisateur
  socket.send(JSON.stringify({ type: 'history', messages: messagesHistory }));

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'message') {
        const fullMessage = parsed.text;
        messagesHistory.push(fullMessage);
        // Garder max 100 messages
        if (messagesHistory.length > 100) messagesHistory.shift();
        // Diffuser à tous
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', text: fullMessage }));
          }
        });
        console.log('📩', fullMessage);
      }
    } catch (e) {
      console.log('Message non JSON, ignoré');
    }
  });

  socket.on('close', () => {
    console.log('👋 Utilisateur déconnecté');
  });
});
