// 🔹 Détecter le mode (général ou privé)
const urlParams = new URLSearchParams(window.location.search);
const isPrivate = window.location.pathname.includes('private.html');
const targetUser = isPrivate ? urlParams.get('with') : null;

// 🔹 Charger le pseudo IMMÉDIATEMENT depuis localStorage
let user = localStorage.getItem('quickchat_user') || '';
let mediaRecorder;
let audioChunks = [];
let socket = null;
let typingTimer = null;
let isTyping = false;

// Sauvegarde locale
let messagesHistory = [];
const storageKey = isPrivate 
  ? `private_${user}_${targetUser}`
  : 'general_history';

// Éléments DOM
const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const pseudoInput = document.getElementById('pseudo');
const msgInput = document.getElementById('msg');
const chatDiv = document.getElementById('chat');
const typingIndicator = document.getElementById('typingIndicator');
const clearMineBtn = document.getElementById('clearMineBtn');
const joinBtn = document.getElementById('joinBtn');
const sendBtn = document.getElementById('sendBtn');
const recordBtn = document.getElementById('recordBtn');
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
const notifSound = document.getElementById('notif-sound');
const onlinePanel = document.getElementById('onlinePanel');
const onlineList = document.getElementById('onlineList');
const onlineCount = document.getElementById('onlineCount');
const privateTitle = document.getElementById('privateTitle');

// Initialisation de l'interface
if (isPrivate && targetUser) {
  if (!user) {
    alert('Veuillez d’abord vous connecter sur la page principale.');
    window.location.href = 'index.html';
  } else {
    document.title = `💬 Privé avec ${targetUser}`;
    if (privateTitle) privateTitle.textContent = `💬 Chat privé avec ${targetUser}`;
    chatApp.style.display = 'block';
    if (loginScreen) loginScreen.remove();
    onlinePanel?.remove();
  }
} else {
  if (loginScreen) loginScreen.style.display = 'block';
  chatApp.style.display = 'none';
  if (onlinePanel) onlinePanel.style.display = 'none';
}

// Événements
if (joinBtn) joinBtn.addEventListener('click', join);
sendBtn.addEventListener('click', send);
msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') send();
});
msgInput.addEventListener('input', handleTyping);
if (clearMineBtn) clearMineBtn.addEventListener('click', clearMine);
recordBtn.addEventListener('click', toggleRecording);
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', sendFile);

// Connexion WebSocket
function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    console.log('🟢 WebSocket connecté');
    if (!isPrivate) {
      socket.send(JSON.stringify({ type: 'set_pseudo', pseudo: user }));
    } else {
      // En mode privé, on est déjà authentifié via localStorage
      // Pas besoin d'envoyer set_pseudo
    }
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'history' && !isPrivate) {
        chatDiv.innerHTML = '';
        data.messages.forEach(msg => displayMessage(msg));
        chatDiv.scrollTop = chatDiv.scrollHeight;
      }
      else if (data.type === 'message' && !isPrivate) {
        displayMessage(data.text, data.id, data.timestamp, data.media, data.audio);
        notifSound.play().catch(() => {});
        typingIndicator.textContent = '';
      }
      else if (data.type === 'private_message' && isPrivate) {
        // Afficher uniquement les messages entre user et targetUser
        if ((data.from === user && data.to === targetUser) || 
            (data.from === targetUser && data.to === user)) {
          displayMessage(data.text, data.id, data.timestamp, data.media, data.audio);
          notifSound.play().catch(() => {});
        }
      }
      else if (data.type === 'edit') {
        const msgDiv = document.querySelector(`.message[data-id="${data.id}"]`);
        if (msgDiv) {
          const sender = extractSender(data.text);
          const color = stringToColor(sender);
          const match = data.text.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
          if (match) {
            msgDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]} <span class="edited">(✏️ modifié)</span>`;
          }
        }
      }
      else if (data.type === 'delete_message') {
        const msgDiv = document.querySelector(`.message[data-id="${data.id}"]`);
        if (msgDiv) msgDiv.remove();
      }
      else if (data.type === 'clear_all' && !isPrivate) {
        chatDiv.innerHTML = '';
        alert('🗑️ La conversation a été effacée par un utilisateur.');
      }
      else if (data.type === 'typing' && !isPrivate) {
        typingIndicator.textContent = data.user + ' est en train d’écrire...';
      }
      else if (data.type === 'stop_typing' && !isPrivate) {
        typingIndicator.textContent = '';
      }
      else if (data.type === 'online_users' && !isPrivate) {
        onlineList.innerHTML = '';
        data.users.forEach(u => {
          if (u !== user) {
            const li = document.createElement('li');
            li.textContent = u;
            li.onclick = () => startPrivateChat(u);
            onlineList.appendChild(li);
          }
        });
        onlineCount.textContent = data.users.length;
        if (onlinePanel) onlinePanel.style.display = 'block';
      }
      else if (data.type === 'error') {
        alert(data.message);
      }
    } catch (err) {
      console.error('Erreur message:', err);
    }
  };

  socket.onerror = (error) => {
    console.error('❌ Erreur WebSocket:', error);
  };

  socket.onclose = () => {
    console.log('🔴 Connexion fermée');
    setTimeout(() => {
      if (user) connectWebSocket();
    }, 3000);
  };
}

// Utilitaires
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = '#';
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ('00' + value.toString(16)).substr(-2);
  }
  return color;
}

function extractSender(message) {
  const match = message.match(/^\[.*?\]\s*(.*?):/);
  return match ? match[1] : 'Inconnu';
}

function displayMessage(fullMessage, id, timestamp, mediaData, audioData) {
  if (!fullMessage || typeof fullMessage !== 'string') return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  if (id) messageDiv.dataset.id = id;
  if (timestamp) messageDiv.dataset.timestamp = timestamp;

  const sender = extractSender(fullMessage);
  const color = stringToColor(sender);
  const match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
  
  if (match) {
    messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
  } else {
    messageDiv.textContent = fullMessage;
  }

  if (audioData) {
    const audioElement = document.createElement('audio');
    audioElement.controls = true;
    audioElement.style.width = '100%';
    audioElement.src = audioData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(audioElement);
  }
  if (mediaData) {
    const isVideo = mediaData.includes('video/');
    const mediaElement = isVideo 
      ? document.createElement('video') 
      : document.createElement('img');
    if (isVideo) {
      mediaElement.controls = true;
      mediaElement.style.width = '250px';
    } else {
      mediaElement.style.maxWidth = '250px';
      mediaElement.style.borderRadius = '8px';
    }
    mediaElement.src = mediaData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(mediaElement);
  }

  const isOwnMessage = sender === user;
  if (timestamp && Date.now() - timestamp < 5 * 60 * 1000 && isOwnMessage) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const safeMsg = fullMessage.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    actions.innerHTML = `<button onclick="editMessage('${id}', \`${safeMsg}\`)">✏️ Modifier</button>`;
    messageDiv.appendChild(actions);
  }

  if (isOwnMessage) {
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.innerHTML = '⋮';
    dots.onclick = (e) => {
      e.stopPropagation();
      showActionsMenu(messageDiv, id, fullMessage);
    };
    messageDiv.appendChild(dots);
  }

  chatDiv.appendChild(messageDiv);
  chatDiv.scrollTop = messageDiv.offsetTop;

  // Sauvegarder localement
  if (isPrivate) {
    messagesHistory.push(fullMessage);
    localStorage.setItem(storageKey, JSON.stringify(messagesHistory));
  }
}

function showActionsMenu(messageDiv, messageId, fullMessage) {
  document.querySelectorAll('.message-actions-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'message-actions-menu';
  
  const deleteForMe = document.createElement('button');
  deleteForMe.innerHTML = '🗑️ Supprimer pour moi';
  deleteForMe.onclick = () => {
    messageDiv.remove();
    menu.remove();
  };
  menu.appendChild(deleteForMe);

  const deleteForAll = document.createElement('button');
  deleteForAll.innerHTML = isPrivate ? '🌍 Supprimer pour les deux' : '🌍 Supprimer pour tous';
  deleteForAll.onclick = () => {
    if (confirm('Supprimer ce message pour TOUS ?')) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const type = isPrivate ? 'delete_private' : 'delete_for_all';
        socket.send(JSON.stringify({
          type: type,
          id: messageId,
          originalPrefix: fullMessage.split('] ')[0] + '] ',
          to: isPrivate ? targetUser : null
        }));
        messageDiv.remove();
      } else {
        alert('Connexion perdue.');
      }
    }
    menu.remove();
  };
  menu.appendChild(deleteForAll);

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '❌ Fermer';
  closeBtn.onclick = () => {
    menu.remove();
  };
  menu.appendChild(closeBtn);

  messageDiv.appendChild(menu);
  menu.style.display = 'block';
}

function editMessage(id, fullMessage) {
  const content = fullMessage.split(': ').slice(1).join(': ');
  const newText = prompt('Modifier le message :', content);
  if (newText !== null && newText.trim() !== '') {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updatedMsg = fullMessage.replace(/: .*/, `: ${newText.trim()}`);
    const prefix = fullMessage.split('] ')[0] + '] ';
    if (socket && socket.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'edit',
        id: id,
        text: updatedMsg,
        originalPrefix: prefix
      };
      if (isPrivate) payload.to = targetUser;
      socket.send(JSON.stringify(payload));
    }
  }
}

function toggleRecording() {
  if (recordBtn.classList.contains('active')) {
    if (mediaRecorder) mediaRecorder.stop();
    recordBtn.classList.remove('active');
    recordBtn.textContent = '🎤';
  } else {
    startRecording();
  }
}

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const msg = `[${t}] ${user}: 🎧 [Message vocal]`;
          const id = `${user}-${Date.now()}-audio-${Math.random().toString(36).substr(2, 5)}`;
          if (socket && socket.readyState === WebSocket.OPEN) {
            const payload = {
              type: isPrivate ? 'private_message' : 'message',
              text: msg,
              id: id,
              timestamp: Date.now(),
              audio: reader.result
            };
            if (isPrivate) payload.to = targetUser;
            socket.send(JSON.stringify(payload));
          }
        };
        reader.readAsDataURL(audioBlob);
        recordBtn.classList.remove('active');
        recordBtn.textContent = '🎤';
      };
      mediaRecorder.start();
      recordBtn.classList.add('active');
      recordBtn.textContent = '⏹️';
    })
    .catch(err => alert('Micro non autorisé : ' + err));
}

function sendFile() {
  const file = fileInput.files[0];
  if (!file) return;
  if (!file.type.match('image.*|video.*')) {
    alert('Veuillez choisir une image ou une vidéo.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mediaTag = file.type.startsWith('video') ? '🎥' : '🖼️';
    const msg = `[${t}] ${user}: ${mediaTag} [Média]`;
    const id = `${user}-${Date.now()}-media-${Math.random().toString(36).substr(2, 5)}`;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const payload = {
        type: isPrivate ? 'private_message' : 'message',
        text: msg,
        id: id,
        timestamp: Date.now(),
        media: e.target.result
      };
      if (isPrivate) payload.to = targetUser;
      socket.send(JSON.stringify(payload));
    }
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
}

function clearMine() {
  if (confirm('Effacer l’historique DE CE navigateur ?')) {
    chatDiv.innerHTML = '';
    if (!isPrivate) {
      localStorage.removeItem('general_history');
    } else {
      localStorage.removeItem(storageKey);
    }
  }
}

function join() {
  const p = pseudoInput.value.trim();
  if (p && p.length >= 2) {
    user = p;
    localStorage.setItem('quickchat_user', user);
    if (loginScreen) loginScreen.style.display = 'none';
    chatApp.style.display = 'block';
    if (clearMineBtn) clearMineBtn.style.display = 'inline-block';
    onlinePanel.style.display = 'block';
    connectWebSocket();
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

function send() {
  if (!user) {
    alert('❌ Vous devez d’abord vous connecter sur la page principale.');
    window.location.href = 'index.html';
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Connexion perdue. Veuillez rafraîchir la page.');
    return;
  }

  const m = msgInput.value.trim();
  if (m && user) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fullMsg = `[${t}] ${user}: ${m}`;
    const id = `${user}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    const payload = {
      type: isPrivate ? 'private_message' : 'message',
      text: fullMsg,
      id: id,
      timestamp: Date.now()
    };
    
    if (isPrivate) {
      if (!targetUser) {
        alert('Erreur : destinataire non défini.');
        return;
      }
      payload.to = targetUser;
    }

    socket.send(JSON.stringify(payload));
    
    msgInput.value = '';
    
    if (!isPrivate && isTyping) {
      isTyping = false;
      socket.send(JSON.stringify({ type: 'stop_typing', user: user }));
    }
  }
}

function handleTyping() {
  if (!isPrivate && !isTyping && user) {
    isTyping = true;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'typing', user: user }));
    }
  }
  if (!isPrivate) {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (isTyping) {
        isTyping = false;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'stop_typing', user: user }));
        }
      }
    }, 3000);
  }
}

function startPrivateChat(target) {
  window.open(`private.html?with=${encodeURIComponent(target)}`, '_blank');
}

// 🔹 Charger l'historique et connecter le WebSocket en mode privé
if (isPrivate && targetUser) {
  if (user) {
    messagesHistory = JSON.parse(localStorage.getItem(storageKey) || '[]');
    messagesHistory.forEach(msg => displayMessage(msg));
    connectWebSocket();
  }
} else if (!isPrivate) {
  // Rien de spécial à faire ici — join() déclenchera connectWebSocket()
}
