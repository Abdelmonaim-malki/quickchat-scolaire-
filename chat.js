// ───── CONFIG ─────
let user = localStorage.getItem('quickchat_user') || '';
let mediaRecorder;
let audioChunks = [];
let socket = null;
let typingTimer = null;
let isTyping = false;
let currentConversation = 'general'; // 'general' ou 'private:Ali'

// ───── DOM ─────
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
const backToGeneralBtn = document.getElementById('backToGeneralBtn');

// ───── ÉVÉNEMENTS (une seule fois) ─────
joinBtn.onclick = join;
sendBtn.onclick = send;
msgInput.onkeypress = (e) => { if (e.key === 'Enter') send(); };
msgInput.oninput = handleTyping;
clearMineBtn?.onclick = clearMine;
recordBtn.onclick = toggleRecording;
fileBtn.onclick = () => fileInput.click();
fileInput.onchange = sendFile;
backToGeneralBtn?.onclick = () => switchToGeneral();

// ───── FONCTIONS ─────
function switchToGeneral() {
  currentConversation = 'general';
  backToGeneralBtn.style.display = 'none';
  loadConversation('general');
}

function loadConversation(key) {
  // On ne charge pas d'historique local ici pour simplifier
  // (l'historique vient du serveur pour le général, et on affiche au fur et à mesure pour les privés)
  chatDiv.innerHTML = '';
  typingIndicator.textContent = '';
}

function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    if (!user) return;
    socket.send(JSON.stringify({ type: 'set_pseudo', pseudo: user }));
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'history' && currentConversation === 'general') {
        chatDiv.innerHTML = '';
        data.messages.forEach(msg => displayMessage(msg));
        chatDiv.scrollTop = chatDiv.scrollHeight;
      }
      else if (data.type === 'message' && currentConversation === 'general') {
        displayMessage(data.text, data.id, data.timestamp, data.media, data.audio);
        notifSound.play().catch(() => {});
        typingIndicator.textContent = '';
      }
      else if (data.type === 'private_message') {
        // Afficher seulement si on est dans la bonne conversation privée
        if (currentConversation === `private:${data.from}`) {
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
      else if (data.type === 'clear_all' && currentConversation === 'general') {
        chatDiv.innerHTML = '';
        alert('🗑️ La conversation a été effacée par un utilisateur.');
      }
      else if (data.type === 'typing' && currentConversation === 'general') {
        typingIndicator.textContent = data.user + ' est en train d’écrire...';
      }
      else if (data.type === 'stop_typing' && currentConversation === 'general') {
        typingIndicator.textContent = '';
      }
      else if (data.type === 'online_users') {
        onlineList.innerHTML = '';
        data.users.forEach(u => {
          if (u !== user) {
            const li = document.createElement('li');
            li.textContent = u;
            li.style.padding = '6px 0';
            li.style.cursor = 'pointer';
            li.style.color = '#1e88e5';
            li.style.fontWeight = 'bold';
            li.onclick = () => startPrivateChat(u);
            onlineList.appendChild(li);
          }
        });
        onlineCount.textContent = data.users.length;
        onlinePanel.style.display = 'block';
      }
    } catch (err) {
      console.error('Erreur:', err);
    }
  };

  socket.onclose = () => setTimeout(() => { if (user) connectWebSocket(); }, 3000);
}

// ───── UTILITAIRES ─────
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
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
  if (!fullMessage) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  if (id) messageDiv.dataset.id = id;

  const sender = extractSender(fullMessage);
  const color = stringToColor(sender);
  const match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
  
  if (match) {
    messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
  } else {
    messageDiv.textContent = fullMessage;
  }

  if (audioData) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.style.width = '100%';
    audio.src = audioData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(audio);
  }
  if (mediaData) {
    const isVideo = mediaData.includes('video/');
    const el = isVideo ? document.createElement('video') : document.createElement('img');
    if (isVideo) {
      el.controls = true;
      el.style.width = '250px';
    } else {
      el.style.maxWidth = '250px';
      el.style.borderRadius = '8px';
    }
    el.src = mediaData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(el);
  }

  const isOwn = sender === user;
  if (timestamp && Date.now() - timestamp < 5 * 60 * 1000 && isOwn) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const safeMsg = fullMessage.replace(/`/g, '\\`').replace(/\$/g, '\\$');
    actions.innerHTML = `<button onclick="editMessage('${id}', \`${safeMsg}\`)">✏️ Modifier</button>`;
    messageDiv.appendChild(actions);
  }

  if (isOwn) {
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
}

// ───── ACTIONS (éditer, supprimer, etc.) ─────
function showActionsMenu(messageDiv, messageId, fullMessage) {
  document.querySelectorAll('.message-actions-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'message-actions-menu';
  
  const deleteForMe = document.createElement('button');
  deleteForMe.innerHTML = '🗑️ Supprimer pour moi';
  deleteForMe.onclick = () => { messageDiv.remove(); menu.remove(); };
  menu.appendChild(deleteForMe);

  const deleteForAll = document.createElement('button');
  deleteForAll.innerHTML = currentConversation === 'general' ? '🌍 Supprimer pour tous' : '🌍 Supprimer pour les deux';
  deleteForAll.onclick = () => {
    if (confirm('Supprimer pour TOUS ?')) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: currentConversation === 'general' ? 'delete_for_all' : 'delete_private',
          id: messageId,
          originalPrefix: fullMessage.split('] ')[0] + '] ',
          to: currentConversation === 'general' ? null : currentConversation.split(':')[1]
        }));
        messageDiv.remove();
      }
    }
    menu.remove();
  };
  menu.appendChild(deleteForAll);

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '❌ Fermer';
  closeBtn.onclick = () => menu.remove();
  menu.appendChild(closeBtn);

  messageDiv.appendChild(menu);
  menu.style.display = 'block';
}

function editMessage(id, fullMessage) {
  const content = fullMessage.split(': ').slice(1).join(': ');
  const newText = prompt('Modifier :', content);
  if (newText?.trim()) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updated = fullMessage.replace(/: .*/, `: ${newText.trim()}`);
    const prefix = fullMessage.split('] ')[0] + '] ';
    if (socket?.readyState === WebSocket.OPEN) {
      const payload = { type: 'edit', id, text: updated, originalPrefix: prefix };
      if (currentConversation !== 'general') payload.to = currentConversation.split(':')[1];
      socket.send(JSON.stringify(payload));
    }
  }
}

// ───── ENVOI ─────
function send() {
  if (!user || !msgInput.value.trim() || !socket || socket.readyState !== WebSocket.OPEN) return;

  const m = msgInput.value.trim();
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fullMsg = `[${t}] ${user}: ${m}`;
  const id = `${user}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const payload = {
    type: currentConversation === 'general' ? 'message' : 'private_message',
    text: fullMsg,
    id,
    timestamp: Date.now()
  };
  if (currentConversation !== 'general') payload.to = currentConversation.split(':')[1];

  socket.send(JSON.stringify(payload));

  // Afficher immédiatement (optimistic UI)
  displayMessage(fullMsg, id, Date.now());

  msgInput.value = '';
  if (currentConversation === 'general' && isTyping) {
    isTyping = false;
    socket.send(JSON.stringify({ type: 'stop_typing', user }));
  }
}

// ───── MÉDIAS ─────
function toggleRecording() {
  if (recordBtn.classList.contains('active')) {
    mediaRecorder?.stop();
    recordBtn.classList.remove('active');
    recordBtn.textContent = '🎤';
  } else {
    startRecording();
  }
}

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msg = `[${t}] ${user}: 🎧 [Message vocal]`;
        const id = `${user}-${Date.now()}-audio`;
        if (socket?.readyState === WebSocket.OPEN) {
          const payload = {
            type: currentConversation === 'general' ? 'message' : 'private_message',
            text: msg,
            id,
            timestamp: Date.now(),
            audio: reader.result
          };
          if (currentConversation !== 'general') payload.to = currentConversation.split(':')[1];
          socket.send(JSON.stringify(payload));
          displayMessage(msg, id, Date.now(), null, reader.result);
        }
      };
      reader.readAsDataURL(blob);
      recordBtn.classList.remove('active');
      recordBtn.textContent = '🎤';
    };
    mediaRecorder.start();
    recordBtn.classList.add('active');
    recordBtn.textContent = '⏹️';
  }).catch(err => alert('Micro refusé : ' + err.message));
}

function sendFile() {
  const file = fileInput.files[0];
  if (!file || !file.type.match('image.*|video.*')) {
    alert('Image ou vidéo uniquement.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tag = file.type.startsWith('video') ? '🎥' : '🖼️';
    const msg = `[${t}] ${user}: ${tag} [Média]`;
    const id = `${user}-${Date.now()}-media`;
    if (socket?.readyState === WebSocket.OPEN) {
      const payload = {
        type: currentConversation === 'general' ? 'message' : 'private_message',
        text: msg,
        id,
        timestamp: Date.now(),
        media: e.target.result
      };
      if (currentConversation !== 'general') payload.to = currentConversation.split(':')[1];
      socket.send(JSON.stringify(payload));
      displayMessage(msg, id, Date.now(), e.target.result);
    }
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
}

// ───── AUTRES ─────
function handleTyping() {
  if (currentConversation !== 'general') return;
  if (!isTyping && user) {
    isTyping = true;
    socket?.send(JSON.stringify({ type: 'typing', user }));
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      socket?.send(JSON.stringify({ type: 'stop_typing', user }));
    }
  }, 3000);
}

function clearMine() {
  if (confirm('Effacer vos messages locaux ?')) chatDiv.innerHTML = '';
}

function join() {
  const p = pseudoInput.value.trim();
  if (p && p.length >= 2) {
    user = p;
    localStorage.setItem('quickchat_user', user);
    loginScreen.style.display = 'none';
    chatApp.style.display = 'block';
    clearMineBtn.style.display = 'inline-block';
    connectWebSocket();
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

function startPrivateChat(target) {
  currentConversation = `private:${target}`;
  backToGeneralBtn.style.display = 'inline-block';
  chatDiv.innerHTML = '';
  typingIndicator.textContent = '';
}

// ───── INIT ─────
if (user) {
  loginScreen.style.display = 'none';
  chatApp.style.display = 'block';
  clearMineBtn.style.display = 'inline-block';
  connectWebSocket();
}
