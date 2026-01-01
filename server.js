const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Stockage des utilisateurs
const clients = new Map(); // socket => { pseudo, socket }

// Historique général
let generalHistory = [];

// Historique des conversations privées : { "Ali-Sara": [msg1, msg2] }
let privateHistories = {};

function getPrivateRoom(user1, user2) {
  return [user1, user2].sort().join('-');
}

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, url);

  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403);
    res.end('Accès interdit');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Fichier non trouvé');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  console.log('👤 Nouvel utilisateur connecté');

  // Envoyer historique général et liste des utilisateurs
  socket.send(JSON.stringify({ type: 'init', history: generalHistory, users: Array.from(clients.values()).map(c => c.pseudo) }));

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      
      // Authentification (premier message)
      if (parsed.type === 'auth') {
        const pseudo = parsed.pseudo;
        clients.set(socket, { pseudo, socket });
        
        // Annoncer à tous que l'utilisateur est en ligne
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'user_join', user: pseudo }));
          }
        });
        return;
      }

      // Message général
      if (parsed.type === 'message' && parsed.target === 'general') {
        generalHistory.push(parsed.text);
        if (generalHistory.length > 100) generalHistory.shift();
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'message', text: parsed.text, target: 'general' }));
          }
        });
      }
      // Message privé
      else if (parsed.type === 'message' && parsed.target && parsed.target !== 'general') {
        const privateRoom = getPrivateRoom(parsed.sender, parsed.target);
        if (!privateHistories[privateRoom]) privateHistories[privateRoom] = [];
        privateHistories[privateRoom].push(parsed.text);
        if (privateHistories[privateRoom].length > 100) privateHistories[privateRoom].shift();

        // Envoyer seulement aux deux utilisateurs
        clients.forEach(client => {
          if (client.pseudo === parsed.sender || client.pseudo === parsed.target) {
            client.socket.send(JSON.stringify({ 
              type: 'message', 
              text: parsed.text,
              target: privateRoom,
              isPrivate: true
            }));
          }
        });
      }
      // Suppression globale (dans le général seulement)
      else if (parsed.type === 'message' && parsed.text.includes('remove conv from all')) {
        const parts = parsed.text.split(': ');
        if (parsed.target === 'general' && parts.length >= 2) {
          const messageContent = parts.slice(1).join(': ').trim();
          if (messageContent === 'remove conv from all') {
            generalHistory = [];
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'clear_all' }));
              }
            });
            return;
          }
        }
      }
    } catch (e) {
      console.log('Message non JSON, ignoré');
    }
  });

  socket.on('close', () => {
    const client = clients.get(socket);
    if (client) {
      clients.delete(socket);
      // Annoncer que l'utilisateur est parti
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'user_leave', user: client.pseudo }));
        }
      });
    }
    console.log('👋 Utilisateur déconnecté');
  });
});
