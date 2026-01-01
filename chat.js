// ───────────── CONFIGURATION INITIALE ─────────────
let user = localStorage.getItem('quickchat_user') || '';
let mediaRecorder;
let audioChunks = [];
let socket = null;
let typingTimer = null;
let isTyping = false;

// État des conversations
let currentConversation = 'general'; // 'general' ou 'private:Ali'
const conversations = new Map(); // Map<key, { messages: [], unread: 0 }>

// Charger les conversations au démarrage
function loadConversations() {
  const saved = localStorage.getItem('quickchat_conversations');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      for (const [key, data] of Object.entries(parsed)) {
        conversations.set(key, {
          messages: data.messages || [],
          unread: data.unread || 0
        });
      }
    } catch (e) {
      console.warn('Historique corrompu, réinitialisation.');
    }
  }
  if (!conversations.has('general')) {
    conversations.set('general', { messages: [], unread: 0 });
  }
}
loadConversations();

// Sauvegarder les conversations
function saveConversations() {
  const data = {};
  for (const [key, value] of conversations.entries()) {
    data[key] = { messages: value.messages, unread: value.unread };
  }
  localStorage.setItem('quickchat_conversations', JSON.stringify(data));
}

// ───────────── ÉLÉMENTS DOM ─────────────
const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const pseudoInput = document.getElementById('pseudo');
const msgInput = document.getElementById('msg');
const chatDiv = document.getElementById('chat');
const typingIndicator = document.getElementById('typingIndicator');
const joinBtn = document.getElementById('joinBtn');
const sendBtn = document.getElementById('sendBtn');
const recordBtn = document.getElementById('recordBtn');
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
const notifSound = document.getElementById('notif-sound');
const convList = document.getElementById('convList');
const onlineList = document.getElementById('onlineList');
const chatTitle = document.getElementById('chatTitle');
const backToGeneralBtn = document.getElementById('backToGeneralBtn');
const conversationsPanel = document.getElementById('conversations');

// ───────────── AFFICHAGE DES CONVERSATIONS ─────────────
function showConversation(key) {
  currentConversation = key;
  chatDiv.innerHTML = '';
  
  const conv = conversations.get(key) || { messages: [] };
  conv.messages.forEach(msg => {
    displayMessage(msg.text, msg.id, msg.timestamp, msg.media, msg.audio, msg.sender);
  });

  // UI active
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.querySelector(`.conv-item[data-conv="${key}"]`);
  if (activeItem) activeItem.classList.add('active');

  // Titre
  if (key === 'general') {
    chatTitle.textContent = '💬 QuickChat ULTIME';
    backToGeneralBtn.style.display = 'none';
  } else {
    const target = key.split(':')[1] || 'Inconnu';
    chatTitle.textContent = `💬 Privé avec ${target}`;
    backToGeneralBtn.style.display = 'inline-block';
  }

  // Réinitialiser non-lus
  conv.unread = 0;
  updateUnreadUI(key);
  saveConversations();
}

function addPrivateConversation(target) {
  const key = `private:${target}`;
  if (!conversations.has(key)) {
    conversations.set(key, { messages: [], unread: 0 });
    saveConversations();
  }

  if (!document.querySelector(`.conv-item[data-conv="${key}"]`)) {
    const li = document.createElement('li');
    li.className = 'conv-item';
    li.dataset.conv = key;
    li.textContent = `👤 ${target}`;
    li.onclick = () => showConversation(key);
    convList.appendChild(li);
  }
}

function updateUnreadUI(key) {
  const conv = conversations.get(key);
  const item = document.querySelector(`.conv-item[data-conv="${key}"]`);
  if (item && conv && conv.unread > 0) {
    item.textContent = `👤 ${key.split(':')[1]}`;
    item.classList.add('unread');
    item.dataset.unread = conv.unread;
  } else if (item) {
    item.classList.remove('unread');
    item.textContent = `👤 ${key.split(':')[1]}`;
  }
}

// ───────────── FONCTIONS MESSAGES ─────────────
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

function displayMessage(fullMessage, id, timestamp, mediaData, audioData, sender) {
  if (!fullMessage || typeof fullMessage !== 'string') return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  if (sender === user) messageDiv.classList.add('own');
  if (id) messageDiv.dataset.id = id;
  if (timestamp) messageDiv.dataset.timestamp = timestamp;

  const color = stringToColor(sender);
  const match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
  if (match) {
    messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
  } else {
    messageDiv.textContent = fullMessage;
  }

  // Audio
  if (audioData) {
    const audioElement = document.createElement('audio');
    audioElement.controls = true;
    audioElement.style.width = '100%';
    audioElement.src = audioData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(audioElement);
  }

  // Image/vidéo
  if (mediaData) {
    const isVideo = mediaData.includes('video/');
    const mediaElement = isVideo 
      ? document.createElement('video') 
      : document.createElement('img');
    if (isVideo) {
      mediaElement.controls = true;
      mediaElement.style.width = '100%';
      mediaElement.style.maxWidth = '250px';
    } else {
      mediaElement.style.maxWidth = '100%';
      mediaElement.style.borderRadius = '8px';
    }
    mediaElement.src = mediaData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(mediaElement);
  }

  // Actions (modifier/supprimer) — seulement pour ses propres messages récents
  const isOwnMessage = sender === user;
  if (timestamp && Date.now() - timestamp < 5 * 60 * 1000 && isOwnMessage) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const safeMsg = fullMessage.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    actions.innerHTML = `<button onclick="editMessage('${id}', \`${safeMsg}\`)">✏️ Modifier</button>`;
    messageDiv.appendChild(actions);
  }

  // Menu déroulant (points verticaux)
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
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

function showActionsMenu(messageDiv, messageId, fullMessage) {
  // Fermer les autres menus
  document.querySelectorAll('.message-actions-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'message-actions-menu';
  
  // Supprimer pour moi
  const deleteForMe = document.createElement('button');
  deleteForMe.innerHTML = '🗑️ Supprimer pour moi';
  deleteForMe.onclick = () => {
    messageDiv.remove();
    menu.remove();
    // Supprimer localement
    const conv = conversations.get(currentConversation);
    if (conv) {
      conv.messages = conv.messages.filter(m => m.id !== messageId);
      saveConversations();
    }
  };
  menu.appendChild(deleteForMe);

  // Supprimer pour tous / les deux
  const deleteForAll = document.createElement('button');
  deleteForAll.innerHTML = currentConversation === 'general' 
    ? '🌍 Supprimer pour tous' 
    : '🌍 Supprimer pour les deux';
  deleteForAll.onclick = () => {
    if (confirm('Supprimer ce message pour TOUS les participants ?')) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        const payload = {
          type: currentConversation === 'general' ? 'delete_for_all' : 'delete_private',
          id: messageId,
          originalPrefix: fullMessage.split('] ')[0] + '] '
        };
        if (currentConversation !== 'general') {
          payload.to = currentConversation.split(':')[1];
        }
        socket.send(JSON.stringify(payload));
      }
      messageDiv.remove();
      menu.remove();
      // Supprimer localement
      const conv = conversations.get(currentConversation);
      if (conv) {
        conv.messages = conv.messages.filter(m => m.id !== messageId);
        saveConversations();
      }
    } else {
      menu.remove();
    }
  };
  menu.appendChild(deleteForAll);

  // Fermer
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '❌ Fermer';
  closeBtn.onclick = () => menu.remove();
  menu.appendChild(closeBtn);

  messageDiv.appendChild(menu);
  menu.style.display = 'flex';
}

// ───────────── ÉDITION DE MESSAGE ─────────────
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
      if (currentConversation !== 'general') {
        payload.to = currentConversation.split(':')[1];
      }
      socket.send(JSON.stringify(payload));
    }
  }
}

// ───────────── ENVOI DE MÉDIAS ─────────────
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
          
          const payload = {
            type: currentConversation === 'general' ? 'message' : 'private_message',
            text: msg,
            id: id,
            timestamp: Date.now(),
            audio: reader.result
          };
          if (currentConversation !== 'general') {
            payload.to = currentConversation.split(':')[1];
          }
          
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
          }
          
          // Ajouter localement
          const conv = conversations.get(currentConversation);
          if (conv) {
            conv.messages.push({ text: msg, id, timestamp: Date.now(), audio: reader.result, sender: user });
            saveConversations();
            if (currentConversation === currentConversation) {
              displayMessage(msg, id, Date.now(), null, reader.result, user);
            }
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
    .catch(err => alert('Micro non autorisé : ' + err.message));
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
    
    const payload = {
      type: currentConversation === 'general' ? 'message' : 'private_message',
      text: msg,
      id: id,
      timestamp: Date.now(),
      media: e.target.result
    };
    if (currentConversation !== 'general') {
      payload.to = currentConversation.split(':')[1];
    }
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
    
    // Ajouter localement
    const conv = conversations.get(currentConversation);
    if (conv) {
      conv.messages.push({ text: msg, id, timestamp: Date.now(), media: e.target.result, sender: user });
      saveConversations();
      if (currentConversation === currentConversation) {
        displayMessage(msg, id, Date.now(), e.target.result, null, user);
      }
    }
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
}

// ───────────── ENVOI DE MESSAGE ─────────────
function send() {
  if (!user) {
    alert('Connectez-vous d’abord sur la page principale.');
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Connexion perdue.');
    return;
  }
  const m = msgInput.value.trim();
  if (!m) return;

  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fullMsg = `[${t}] ${user}: ${m}`;
  const id = `${user}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  const payload = {
    type: currentConversation === 'general' ? 'message' : 'private_message',
    text: fullMsg,
    id: id,
    timestamp: Date.now()
  };
  if (currentConversation !== 'general') {
    payload.to = currentConversation.split(':')[1];
  }

  socket.send(JSON.stringify(payload));

  // Ajouter localement
  const conv = conversations.get(currentConversation);
  if (conv) {
    conv.messages.push({ text: fullMsg, id, timestamp: Date.now(), sender: user });
    saveConversations();
    displayMessage(fullMsg, id, Date.now(), null, null, user);
  }

  msgInput.value = '';
  if (currentConversation === 'general' && isTyping) {
    isTyping = false;
    socket.send(JSON.stringify({ type: 'stop_typing', user }));
  }
}

// ───────────── SAISIE EN COURS ─────────────
function handleTyping() {
  if (currentConversation !== 'general') return;
  if (!isTyping && user) {
    isTyping = true;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'typing', user }));
    }
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'stop_typing', user }));
      }
    }
  }, 3000);
}

// ───────────── CONNEXION ─────────────
function join() {
  const p = pseudoInput.value.trim();
  if (p && p.length >= 2) {
    user = p;
    localStorage.setItem('quickchat_user', user);
    loginScreen.style.display = 'none';
    conversationsPanel.style.display = 'block';
    chatApp.style.display = 'block';
    connectWebSocket();
    showConversation('general');
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'set_pseudo', pseudo: user }));
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'history') {
        const generalConv = conversations.get('general');
        generalConv.messages = data.messages.map(msg => ({
          text: msg,
          sender: extractSender(msg)
        }));
        if (currentConversation === 'general') {
          showConversation('general');
        }
        saveConversations();
      }
      else if (data.type === 'message') {
        const sender = extractSender(data.text);
        const msgObj = {
          text: data.text,
          id: data.id,
          timestamp: data.timestamp,
          media: data.media,
          audio: data.audio,
          sender: sender
        };
        const generalConv = conversations.get('general');
        generalConv.messages.push(msgObj);
        saveConversations();
        if (currentConversation === 'general') {
          displayMessage(data.text, data.id, data.timestamp, data.media, data.audio, sender);
        }
        notifSound.play().catch(() => {});
        typingIndicator.textContent = '';
      }
      else if (data.type === 'private_message') {
        const from = data.from;
        const key = `private:${from}`;
        addPrivateConversation(from);

        const msgObj = {
          text: data.text,
          id: data.id,
          timestamp: data.timestamp,
          media: data.media,
          audio: data.audio,
          sender: from
        };
        const conv = conversations.get(key);
        conv.messages.push(msgObj);
        if (currentConversation !== key) {
          conv.unread++;
          updateUnreadUI(key);
        }
        saveConversations();
        if (currentConversation === key) {
          displayMessage(data.text, data.id, data.timestamp, data.media, data.audio, from);
        }
        notifSound.play().catch(() => {});
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
        // Mettre à jour localement
        updateMessageLocally(data.id, data.text);
      }
      else if (data.type === 'delete_message') {
        const msgDiv = document.querySelector(`.message[data-id="${data.id}"]`);
        if (msgDiv) msgDiv.remove();
        deleteMessageLocally(data.id);
      }
      else if (data.type === 'online_users') {
        onlineList.innerHTML = '';
        data.users.forEach(u => {
          if (u !== user) {
            const li = document.createElement('li');
            li.textContent = u;
            li.onclick = () => {
              addPrivateConversation(u);
              showConversation(`private:${u}`);
            };
            onlineList.appendChild(li);
          }
        });
      }
      else if (data.type === 'typing') {
        if (currentConversation === 'general') {
          typingIndicator.textContent = data.user + ' est en train d’écrire...';
        }
      }
      else if (data.type === 'stop_typing') {
        if (currentConversation === 'general') {
          typingIndicator.textContent = '';
        }
      }
    } catch (err) {
      console.error('Erreur WebSocket:', err);
    }
  };

  socket.onclose = () => {
    console.log('Connexion perdue, reconnexion...');
    setTimeout(() => {
      if (user) connectWebSocket();
    }, 3000);
  };
}

// ───────────── MISE À JOUR LOCALE ─────────────
function updateMessageLocally(id, newText) {
  for (const conv of conversations.values()) {
    const msg = conv.messages.find(m => m.id === id);
    if (msg) {
      msg.text = newText;
      msg.sender = extractSender(newText);
      saveConversations();
      break;
    }
  }
}

function deleteMessageLocally(id) {
  for (const conv of conversations.values()) {
    conv.messages = conv.messages.filter(m => m.id !== id);
  }
  saveConversations();
}

// ───────────── ÉVÉNEMENTS ─────────────
if (joinBtn) joinBtn.addEventListener('click', join);
sendBtn.addEventListener('click', send);
msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
msgInput.addEventListener('input', handleTyping);
recordBtn.addEventListener('click', toggleRecording);
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', sendFile);
if (backToGeneralBtn) backToGeneralBtn.addEventListener('click', () => showConversation('general'));

// Initialisation si déjà connecté
if (user && loginScreen) {
  loginScreen.style.display = 'none';
  conversationsPanel.style.display = 'block';
  chatApp.style.display = 'block';
  connectWebSocket();
  showConversation('general');
}
