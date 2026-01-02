let user = '';
let mediaRecorder;
let audioChunks = [];
let socket = null;
let typingTimer = null;
let isTyping = false;

// 🔹 Gestion des conversations
let currentChat = 'general'; // 'general' ou 'user:Ali'
let onlineUsers = new Set();
let unreadCounts = {}; // { "user:Ali": 2 }

// Éléments DOM
const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const pseudoInput = document.getElementById('pseudo');
const msgInput = document.getElementById('msg');
const chatGeneral = document.getElementById('chat-general');
const typingIndicator = document.getElementById('typingIndicator');
const clearMineBtn = document.getElementById('clearMineBtn');
const joinBtn = document.getElementById('joinBtn');
const sendBtn = document.getElementById('sendBtn');
const recordBtn = document.getElementById('recordBtn');
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
const notifSound = document.getElementById('notif-sound');
const onlineList = document.getElementById('onlineList');
const onlineCount = document.getElementById('onlineCount');
const privateTabsContainer = document.getElementById('privateTabs');
const chatAreasContainer = document.querySelector('.chat-areas');

// Événements
joinBtn.addEventListener('click', join);
sendBtn.addEventListener('click', send);
msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') send();
});
msgInput.addEventListener('input', handleTyping);
clearMineBtn.addEventListener('click', clearMine);
recordBtn.addEventListener('click', toggleRecording);
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', sendFile);

// 🔹 Basculer de conversation
function switchChat(target) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.chat-area').forEach(area => area.classList.remove('active'));
  
  if (target === 'general') {
    document.querySelector('.tab-btn[data-target="general"]').classList.add('active');
    chatGeneral.classList.add('active');
  } else {
    const tabBtn = document.querySelector(`.tab-btn[data-target="${target}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    const chatArea = document.getElementById(`chat-${target}`);
    if (chatArea) chatArea.classList.add('active');
    unreadCounts[target] = 0;
    updateOnlineList();
  }
  
  currentChat = target;
  msgInput.focus();
}

// 🔹 Ouvrir conversation privée
function openPrivateChat(username) {
  if (username === user) return;
  const target = `user:${username}`;
  
  if (document.getElementById(`chat-${target}`)) {
    switchChat(target);
    return;
  }

  // Onglet
  const tabBtn = document.createElement('button');
  tabBtn.className = 'tab-btn';
  tabBtn.textContent = `🔐 ${username}`;
  tabBtn.dataset.target = target;
  tabBtn.onclick = () => switchChat(target);
  privateTabsContainer.appendChild(tabBtn);

  // Zone de chat
  const chatArea = document.createElement('div');
  chatArea.id = `chat-${target}`;
  chatArea.className = 'chat-area';
  chatAreasContainer.appendChild(chatArea);

  // Charger historique
  const saved = localStorage.getItem(`conv-${target}`);
  if (saved) {
    JSON.parse(saved).forEach(msg => displayMessageInArea(msg, chatArea));
  }

  switchChat(target);
}

// 🔹 Afficher message dans une zone spécifique
function displayMessageInArea(msgData, area) {
  const { fullMessage, id, timestamp, mediaData, audioData, to } = msgData;
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  if (id) messageDiv.dataset.id = id;
  if (timestamp) messageDiv.dataset.timestamp = timestamp;

  const sender = extractSender(fullMessage);
  const color = stringToColor(sender);
  let match;

  if (to) {
    match = fullMessage.match(/(\[.*?\]\s*.*? → .*?:)\s*(.*)/);
    if (match) {
      messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
    } else {
      messageDiv.textContent = fullMessage;
    }
  } else {
    match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
    if (match) {
      messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
    } else {
      messageDiv.textContent = fullMessage;
    }
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

  if (timestamp && Date.now() - timestamp < 5 * 60 * 1000 && sender === user) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const safeMsg = fullMessage.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    actions.innerHTML = `<button onclick="editMessage('${id}', \`${safeMsg}\`)">✏️ Modifier</button>`;
    messageDiv.appendChild(actions);
  }

  if (sender === user) {
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.innerHTML = '⋮';
    dots.onclick = (e) => {
      e.stopPropagation();
      showActionsMenu(messageDiv, id, fullMessage, to);
    };
    messageDiv.appendChild(dots);
  }

  area.appendChild(messageDiv);
  area.scrollTop = messageDiv.offsetTop;
}

// 🔹 Fonction principale d'affichage
function displayMessage(fullMessage, id, timestamp, mediaData, audioData, to = null) {
  if (!fullMessage || typeof fullMessage !== 'string') return;

  let targetArea = null;
  let storageKey = null;

  if (to && to !== user) {
    // Message privé reçu
    const sender = extractSender(fullMessage);
    const target = `user:${sender}`;
    targetArea = document.getElementById(`chat-${target}`);
    storageKey = `conv-${target}`;
    if (currentChat !== target) {
      unreadCounts[target] = (unreadCounts[target] || 0) + 1;
      updateOnlineList();
      notifSound.play().catch(() => {});
    }
  } else if (to === user) {
    // Message privé envoyé
    const matchDest = fullMessage.match(/→ (.*?):/);
    if (matchDest) {
      const dest = matchDest[1];
      const target = `user:${dest}`;
      targetArea = document.getElementById(`chat-${target}`);
      storageKey = `conv-${target}`;
    }
  } else {
    // Général
    targetArea = chatGeneral;
    storageKey = 'conv-general';
  }

  if (!targetArea && to && to !== user) {
    const sender = extractSender(fullMessage);
    const target = `user:${sender}`;
    targetArea = createPrivateChatArea(sender);
    storageKey = `conv-${target}`;
  }

  if (!targetArea) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  if (id) messageDiv.dataset.id = id;
  if (timestamp) messageDiv.dataset.timestamp = timestamp;

  const sender = extractSender(fullMessage);
  const color = stringToColor(sender);
  let match;

  if (to) {
    match = fullMessage.match(/(\[.*?\]\s*.*? → .*?:)\s*(.*)/);
    if (match) {
      messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
    } else {
      messageDiv.textContent = fullMessage;
    }
  } else {
    match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
    if (match) {
      messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
    } else {
      messageDiv.textContent = fullMessage;
    }
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

  if (timestamp && Date.now() - timestamp < 5 * 60 * 1000 && sender === user) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const safeMsg = fullMessage.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    actions.innerHTML = `<button onclick="editMessage('${id}', \`${safeMsg}\`)">✏️ Modifier</button>`;
    messageDiv.appendChild(actions);
  }

  if (sender === user) {
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.innerHTML = '⋮';
    dots.onclick = (e) => {
      e.stopPropagation();
      showActionsMenu(messageDiv, id, fullMessage, to);
    };
    messageDiv.appendChild(dots);
  }

  targetArea.appendChild(messageDiv);
  targetArea.scrollTop = messageDiv.offsetTop;

  // 🔹 Sauvegarder
  const conv = JSON.parse(localStorage.getItem(storageKey) || '[]');
  conv.push({ fullMessage, id, timestamp, mediaData, audioData, to });
  if (conv.length > 100) conv.shift();
  localStorage.setItem(storageKey, JSON.stringify(conv));
}

function createPrivateChatArea(username) {
  const target = `user:${username}`;
  const chatArea = document.createElement('div');
  chatArea.id = `chat-${target}`;
  chatArea.className = 'chat-area';
  chatAreasContainer.appendChild(chatArea);
  return chatArea;
}

function showActionsMenu(messageDiv, messageId, fullMessage, to = null) {
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
  deleteForAll.innerHTML = to ? '🌍 Supprimer pour les deux' : '🌍 Supprimer pour tous';
  deleteForAll.onclick = () => {
    const msg = to ? 'Supprimer ce message pour vous deux ?' : 'Supprimer ce message pour TOUS les utilisateurs ?';
    if (confirm(msg)) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'delete_for_all',
          id: messageId,
          originalPrefix: fullMessage.split('] ')[0] + '] ',
          to: to
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
    const to = currentChat.startsWith('user:') ? currentChat.split(':')[1] : null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'edit',
        id: id,
        text: updatedMsg,
        originalPrefix: prefix,
        to: to
      }));
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
          let fullMsg, to = null;
          if (currentChat.startsWith('user:')) {
            to = currentChat.split(':')[1];
            fullMsg = `[${t}] ${user} → ${to}: 🎧 [Message vocal]`;
          } else {
            fullMsg = `[${t}] ${user}: 🎧 [Message vocal]`;
          }
          const id = `${user}-${Date.now()}-audio-${Math.random().toString(36).substr(2, 5)}`;
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'message',
              text: fullMsg,
              id: id,
              timestamp: Date.now(),
              audio: reader.result,
              to: to
            }));
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
    let fullMsg, to = null;
    if (currentChat.startsWith('user:')) {
      to = currentChat.split(':')[1];
      fullMsg = `[${t}] ${user} → ${to}: ${mediaTag} [Média]`;
    } else {
      fullMsg = `[${t}] ${user}: ${mediaTag} [Média]`;
    }
    const id = `${user}-${Date.now()}-media-${Math.random().toString(36).substr(2, 5)}`;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'message',
        text: fullMsg,
        id: id,
        timestamp: Date.now(),
        media: e.target.result,
        to: to
      }));
    }
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
}

function clearMine() {
  if (confirm('Effacer l’historique DE CE navigateur ?')) {
    if (currentChat === 'general') {
      chatGeneral.innerHTML = '';
      localStorage.removeItem('conv-general');
    } else {
      const area = document.getElementById(`chat-${currentChat}`);
      if (area) area.innerHTML = '';
      localStorage.removeItem(`conv-${currentChat}`);
    }
  }
}

function join() {
  const p = pseudoInput.value.trim();
  if (p && p.length >= 2) {
    user = p;
    loginScreen.style.display = 'none';
    chatApp.style.display = 'block';
    clearMineBtn.style.display = 'inline-block';
    
    // Charger historique général
    const savedGeneral = localStorage.getItem('conv-general');
    if (savedGeneral) {
      JSON.parse(savedGeneral).forEach(msg => {
        displayMessage(msg.fullMessage, msg.id, msg.timestamp, msg.mediaData, msg.audioData, msg.to);
      });
    }

    connectWebSocket();
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    console.log('🟢 Connecté au serveur');
    socket.send(JSON.stringify({
      type: 'user_joined',
      user: user
    }));
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'history') {
        // Pas utilisé en mode privé, mais gardé pour compatibilité
      } 
      else if (data.type === 'message') {
        displayMessage(data.text, data.id, data.timestamp, data.media, data.audio, data.to);
        if (!data.to) typingIndicator.textContent = '';
      }
      else if (data.type === 'edit') {
        const target = data.to ? `user:${data.to}` : 'general';
        const area = data.to ? document.getElementById(`chat-user:${data.to}`) : chatGeneral;
        if (area) {
          const msgDiv = area.querySelector(`.message[data-id="${data.id}"]`);
          if (msgDiv) {
            const sender = extractSender(data.text);
            const color = stringToColor(sender);
            const match = data.text.match(/(\[.*?\]\s*.*?(?: → .*?)?:)\s*(.*)/);
            if (match) {
              msgDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]} <span class="edited">(✏️ modifié)</span>`;
            }
          }
        }
      }
      else if (data.type === 'delete_message') {
        document.querySelectorAll(`.message[data-id="${data.id}"]`).forEach(el => el.remove());
      }
      else if (data.type === 'clear_all') {
        chatGeneral.innerHTML = '';
        localStorage.removeItem('conv-general');
        alert('🗑️ La conversation a été effacée par un utilisateur.');
      }
      else if (data.type === 'typing') {
        typingIndicator.textContent = data.user + ' est en train d’écrire...';
      }
      else if (data.type === 'stop_typing') {
        typingIndicator.textContent = '';
      }
      else if (data.type === 'online_users') {
        onlineUsers = new Set(data.users);
        updateOnlineList();
      }
      else if (data.type === 'user_joined') {
        onlineUsers.add(data.user);
        updateOnlineList();
      }
      else if (data.type === 'user_left') {
        onlineUsers.delete(data.user);
        updateOnlineList();
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

function updateOnlineList() {
  onlineList.innerHTML = '';
  onlineUsers.forEach(u => {
    if (u === user) return;

    const li = document.createElement('li');
    li.textContent = u;
    li.onclick = () => openPrivateChat(u);

    const target = `user:${u}`;
    if (unreadCounts[target] > 0) {
      const badge = document.createElement('span');
      badge.className = 'notification-badge';
      badge.textContent = unreadCounts[target] > 9 ? '9+' : unreadCounts[target];
      li.appendChild(badge);
    }

    onlineList.appendChild(li);
  });
  onlineCount.textContent = onlineUsers.size - 1;
}

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
  const match = message.match(/^\[.*?\]\s*(.*?)(?: → |:)/);
  return match ? match[1] : 'Inconnu';
}

function send() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Connexion perdue. Veuillez rafraîchir la page.');
    return;
  }

  const m = msgInput.value.trim();
  if (m && user) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let fullMsg, targetUser = null;

    if (currentChat.startsWith('user:')) {
      targetUser = currentChat.split(':')[1];
      fullMsg = `[${t}] ${user} → ${targetUser}: ${m}`;
    } else {
      fullMsg = `[${t}] ${user}: ${m}`;
    }

    const id = `${user}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    
    socket.send(JSON.stringify({ 
      type: 'message', 
      text: fullMsg,
      id: id,
      timestamp: Date.now(),
      to: targetUser
    }));

    msgInput.value = '';

    if (isTyping) {
      isTyping = false;
      socket.send(JSON.stringify({ type: 'stop_typing', user: user }));
    }
  }
}

function handleTyping() {
  if (!isTyping && user) {
    isTyping = true;
    socket.send(JSON.stringify({ type: 'typing', user: user }));
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      socket.send(JSON.stringify({ type: 'stop_typing', user: user }));
    }
  }, 3000);
}
