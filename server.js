const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

let messagesHistory = [];
const onlineUsers = new Set();

function extractSenderFromId(id) {
  return id.split('-')[0];
}

function extractSenderFromMessage(msg) {
  const match = msg.match(/^\[.*?\]\s*(.*?):/);
  return match ? match[1] : null;
}

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
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Fichier non trouvé');
      } else {
        res.writeHead(500);
        res.end('Erreur serveur');
      }
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
  socket.send(JSON.stringify({ type: 'history', messages: messagesHistory }));

  let currentUser = null;

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);

      // 🔹 Gestion de l'arrivée d'un utilisateur
      if (parsed.type === 'user_joined' && parsed.user) {
        currentUser = parsed.user;
        onlineUsers.add(currentUser);
        console.log(`✅ ${currentUser} est en ligne`);

        // Envoyer la liste complète à ce nouvel utilisateur
        socket.send(JSON.stringify({
          type: 'online_users',
          users: Array.from(onlineUsers)
        }));

        // Avertir les autres utilisateurs
        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'user_joined',
              user: currentUser
            }));
          }
        });
        return;
      }

      // ❌ Si aucun utilisateur n'est identifié, ignorer les autres messages
      if (!currentUser) {
        console.warn('Message reçu avant identification de l’utilisateur');
        return;
      }

      if (parsed.type === 'message') {
        const fullMessage = parsed.text;
        const parts = fullMessage.split(': ');
        if (parts.length >= 2) {
          const messageContent = parts.slice(1).join(': ').trim();
          if (messageContent === 'remove conv from all') {
            const senderPart = parts[0];
            const senderMatch = senderPart.match(/\]\s*(.*)/);
            const sender = senderMatch ? senderMatch[1] : 'Inconnu';
            if (sender) {
              console.log(`🗑️ ${sender} a demandé la suppression globale !`);
              messagesHistory = [];
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: 'clear_all' }));
                }
              });
              return;
            }
          }
        }

        messagesHistory.push(fullMessage);
        if (messagesHistory.length > 100) messagesHistory.shift();

        const payload = {
          type: 'message',
          text: fullMessage,
          id: parsed.id,
          timestamp: parsed.timestamp
        };
        if (parsed.media) payload.media = parsed.media;
        if (parsed.audio) payload.audio = parsed.audio;

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
          }
        });
        console.log('📩', fullMessage);
      }
      else if (parsed.type === 'edit') {
        const originalMsg = messagesHistory.find(msg => 
          msg.startsWith(parsed.originalPrefix)
        );
        if (originalMsg) {
          const originalSender = extractSenderFromMessage(originalMsg);
          const newSender = extractSenderFromMessage(parsed.text);
          const requester = currentUser;
          if (originalSender && originalSender === newSender && originalSender === requester) {
            const index = messagesHistory.indexOf(originalMsg);
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
        }
      }
      else if (parsed.type === 'delete_for_all') {
        const originalMsg = messagesHistory.find(msg => 
          msg.startsWith(parsed.originalPrefix)
        );
        if (originalMsg) {
          const originalSender = extractSenderFromMessage(originalMsg);
          const requester = currentUser;
          if (originalSender && originalSender === requester) {
            messagesHistory = messagesHistory.filter(msg => 
              !msg.startsWith(parsed.originalPrefix)
            );
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'delete_message',
                  id: parsed.id
                }));
              }
            });
          }
        }
      }
      else if (parsed.type === 'typing') {
        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'typing',
              user: parsed.user
            }));
          }
        });
      }
      else if (parsed.type === 'stop_typing') {
        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'stop_typing',
              user: parsed.user
            }));
          }
        });
      }

    } catch (e) {
      console.log('Message non JSON, ignoré');
    }
  });

  socket.on('close', () => {
    if (currentUser) {
      onlineUsers.delete(currentUser);
      console.log(`👋 ${currentUser} s'est déconnecté`);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'user_left',
            user: currentUser
          }));
        }
      });
    }
  });
});
