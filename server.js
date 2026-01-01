const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Stockage des utilisateurs
const clients = new Map(); // socket => pseudo

// Historique général
let generalHistory = [];

// Historique privé : { "Ali-Sara": [msg1, msg2] }
let privateHistories = {};

function getPrivateRoom(user1, user2) {
  return [user1, user2].sort().join('-');
}

// Servir les fichiers statiques
function serveStaticFile(req, res) {
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
}

const server = http.createServer((req, res) => {
  serveStaticFile(req, res);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (socket) => {
  console.log('👤 Nouvel utilisateur connecté');

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      
      // Authentification
      if (parsed.type === 'auth') {
        const pseudo = parsed.pseudo;
        clients.set(socket, pseudo);
        
        // Envoyer historique général + liste des utilisateurs
        socket.send(JSON.stringify({ 
          type: 'init', 
          history: generalHistory, 
          users: Array.from(clients.values()).filter(u => u !== pseudo) 
        }));
        
        // Annoncer à tous
        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
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
            const payload = {
              type: 'message',
              text: parsed.text,
              target: 'general'
            };
            if (parsed.media) payload.media = parsed.media;
            if (parsed.audio) payload.audio = parsed.audio;
            client.send(JSON.stringify(payload));
          }
        });
      }
      // Message privé
      else if (parsed.type === 'message' && parsed.target && parsed.target !== 'general') {
        const privateRoom = getPrivateRoom(parsed.sender, parsed.target);
        if (!privateHistories[privateRoom]) privateHistories[privateRoom] = [];
        privateHistories[privateRoom].push(parsed.text);
        if (privateHistories[privateRoom].length > 100) privateHistories[privateRoom].shift();

        // Envoyer aux deux utilisateurs
        clients.forEach((pseudo, clientSocket) => {
          if (pseudo === parsed.sender || pseudo === parsed.target) {
            const payload = {
              type: 'message',
              text: parsed.text,
              target: privateRoom,
              isPrivate: true,
              sender: parsed.sender,
              receiver: parsed.target
            };
            if (parsed.media) payload.media = parsed.media;
            if (parsed.audio) payload.audio = parsed.audio;
            clientSocket.send(JSON.stringify(payload));
          }
        });
      }
      // Suppression globale
      else if (parsed.type === 'message' && parsed.text.includes('remove conv from all')) {
        if (parsed.target === 'general') {
          const parts = parsed.text.split(': ');
          if (parts.length >= 2) {
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
      }
      // 🔸 Demande d'historique privé
      else if (parsed.type === 'get_private_history') {
        const room = parsed.room;
        const history = privateHistories[room] || [];
        socket.send(JSON.stringify({ 
          type: 'private_history', 
          room: room, 
          history: history 
        }));
      }
    } catch (e) {
      console.log('Message non JSON, ignoré');
    }
  });

  socket.on('close', () => {
    const pseudo = clients.get(socket);
    if (pseudo) {
      clients.delete(socket);
      // Annoncer le départ
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'user_leave', user: pseudo }));
        }
      });
    }
    console.log('👋 Utilisateur déconnecté');
  });
});
