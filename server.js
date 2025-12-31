const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Historique global
let messagesHistory = [];

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Erreur du serveur');
      } else {
        res.writeHead(20, { 'Content-Type': 'text/html; charset=utf-8' });
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
  socket.send(JSON.stringify({ type: 'history', messages: messagesHistory }));

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'message') {
        const fullMessage = parsed.text;
        const sender = fullMessage.split(': ')[0]?.split('] ')[1] || 'Inconnu';

        // Commande de suppression globale
        if (fullMessage.includes('remove conv from all') && sender) {
          console.log(`🗑️ ${sender} a demandé la suppression globale !`);
          messagesHistory = [];
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'clear_all' }));
            }
          });
          return;
        }

        messagesHistory.push(fullMessage);
        if (messagesHistory.length > 100) messagesHistory.shift();

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ 
              type: 'message', 
              text: fullMessage,
              id: parsed.id,
              timestamp: parsed.timestamp,
              audio: parsed.audio
            }));
          }
        });
        console.log('📩', fullMessage);
      }
      else if (parsed.type === 'edit') {
        // Mettre à jour l'historique
        const index = messagesHistory.findIndex(msg => 
          msg.includes(parsed.originalIdPart)
        );
        if (index !== -1) {
          messagesHistory[index] = parsed.text;
        }
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ 
              type: 'edit',
              id: parsed.id,
              text: parsed.text
            }));
          }
        });
      }
    } catch (e) {
      console.log('Message non JSON, ignoré');
    }
  });

  socket.on('close', () => {
    console.log('👋 Utilisateur déconnecté');
  });
});
