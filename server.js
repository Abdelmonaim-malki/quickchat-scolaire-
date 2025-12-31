const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

let messagesHistory = [];

// 🔒 Extraire le pseudo depuis l'ID (format: pseudo-timestamp-xxx)
function extractSenderFromId(id) {
  return id.split('-')[0];
}

// 🔒 Extraire le pseudo depuis le message (format: [HH:MM] pseudo: message)
function extractSenderFromMessage(msg) {
  const match = msg.match(/^\[.*?\]\s*(.*?):/);
  return match ? match[1] : null;
}

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
  socket.send(JSON.stringify({ type: 'history', messages: messagesHistory }));

  socket.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'message') {
        const fullMessage = parsed.text;

        // 🔒 Suppression globale via texte
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

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            const payload = {
              type: 'message',
              text: fullMessage,
              id: parsed.id,
              timestamp: parsed.timestamp
            };
            if (parsed.media) payload.media = parsed.media;
            if (parsed.audio) payload.audio = parsed.audio;
            client.send(JSON.stringify(payload));
          }
        });
        console.log('📩', fullMessage);
      }
      // 🔒 Modification sécurisée
      else if (parsed.type === 'edit') {
        const originalMsg = messagesHistory.find(msg => 
          msg.startsWith(parsed.originalPrefix)
        );
        if (originalMsg) {
          const originalSender = extractSenderFromMessage(originalMsg);
          const newSender = extractSenderFromMessage(parsed.text);
          const requester = extractSenderFromId(parsed.id);
          // ✅ Vérification triple
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
      // 🔒 Suppression sécurisée
      else if (parsed.type === 'delete_for_all') {
        const originalMsg = messagesHistory.find(msg => 
          msg.startsWith(parsed.originalPrefix)
        );
        if (originalMsg) {
          const originalSender = extractSenderFromMessage(originalMsg);
          const requester = extractSenderFromId(parsed.id);
          // ✅ Seulement l'auteur
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
    } catch (e) {
      console.log('Message non JSON, ignoré');
    }
  });

  socket.on('close', () => {
    console.log('👋 Utilisateur déconnecté');
  });
});
