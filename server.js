const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

let messagesHistory = [];
const clients = new Map(); // Map<socket, { pseudo: string }>

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

function broadcastOnlineUsers() {
  const users = Array.from(clients.values()).map(c => c.pseudo);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'online_users', users }));
    }
  });
}

wss.on('connection', (socket) => {
  console.log('👤 Nouvelle connexion WebSocket');

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);

      if (parsed.type === 'set_pseudo') {
        const pseudo = parsed.pseudo.trim();
        if (!pseudo || pseudo.length < 2) {
          socket.close();
          return;
        }

        const pseudoExists = Array.from(clients.values()).some(c => c.pseudo === pseudo);
        if (pseudoExists) {
          socket.send(JSON.stringify({ type: 'error', message: 'Pseudo déjà utilisé.' }));
          return;
        }

        clients.set(socket, { pseudo });
        socket.send(JSON.stringify({ type: 'history', messages: messagesHistory }));
        broadcastOnlineUsers();
        return;
      }

      const senderInfo = clients.get(socket);
      if (!senderInfo) return;
      const sender = senderInfo.pseudo;

      if (parsed.type === 'message') {
        messagesHistory.push(parsed.text);
        if (messagesHistory.length > 100) messagesHistory.shift();

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            const payload = {
              type: 'message',
              text: parsed.text,
              id: parsed.id,
              timestamp: parsed.timestamp
            };
            if (parsed.media) payload.media = parsed.media;
            if (parsed.audio) payload.audio = parsed.audio;
            client.send(JSON.stringify(payload));
          }
        });
      }

      else if (parsed.type === 'private_message') {
        const target = parsed.to;
        let targetSocket = null;
        for (let [sock, info] of clients.entries()) {
          if (info.pseudo === target) {
            targetSocket = sock;
            break;
          }
        }

        const payload = {
          type: 'private_message',
          from: sender,
          text: parsed.text,
          id: parsed.id,
          timestamp: parsed.timestamp
        };
        if (parsed.media) payload.media = parsed.media;
        if (parsed.audio) payload.audio = parsed.audio;

        if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify(payload));
        }
        // Toujours envoyer à l'expéditeur
        socket.send(JSON.stringify(payload));
      }

      else if (parsed.type === 'edit') {
        if (parsed.to) {
          // Édition privée
          let targetSocket = null;
          for (let [sock, info] of clients.entries()) {
            if (info.pseudo === parsed.to) {
              targetSocket = sock;
              break;
            }
          }
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(JSON.stringify({
              type: 'edit',
              id: parsed.id,
              text: parsed.text
            }));
          }
          socket.send(JSON.stringify({
            type: 'edit',
            id: parsed.id,
            text: parsed.text
          }));
        } else {
          // Édition publique
          const originalMsg = messagesHistory.find(msg => 
            msg.startsWith(parsed.originalPrefix)
          );
          if (originalMsg) {
            const originalSender = extractSenderFromMessage(originalMsg);
            if (originalSender === sender) {
              const index = messagesHistory.indexOf(originalMsg);
              if (index !== -1) messagesHistory[index] = parsed.text;
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
      }

      else if (parsed.type === 'delete_for_all') {
        const originalMsg = messagesHistory.find(msg => 
          msg.startsWith(parsed.originalPrefix)
        );
        if (originalMsg) {
          const originalSender = extractSenderFromMessage(originalMsg);
          if (originalSender === sender) {
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
              user: sender
            }));
          }
        });
      }

      else if (parsed.type === 'stop_typing') {
        wss.clients.forEach(client => {
          if (client !== socket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'stop_typing',
              user: sender
            }));
          }
        });
      }

    } catch (e) {
      console.error('Erreur parsing:', e);
    }
  });

  socket.on('close', () => {
    const client = clients.get(socket);
    if (client) {
      console.log(`👋 ${client.pseudo} déconnecté`);
      clients.delete(socket);
      broadcastOnlineUsers();
    }
  });
});
