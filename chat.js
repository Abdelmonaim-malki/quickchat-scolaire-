let user = '';
let mediaRecorder;
let audioChunks = [];
let socket = null;
let typingTimer = null;
let isTyping = false;

// 🔹 État actuel
let currentConversation = 'general'; // 'general' ou 'private:Ali'
const conversations = new Map(); // Map<key, { messages: [], unread: 0 }>

// Éléments DOM
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

// Charger les conversations depuis localStorage
function loadConversations() {
  const saved = localStorage.getItem('quickchat_conversations');
  if (saved) {
    const parsed = JSON.parse(saved);
    for (const [key, data] of Object.entries(parsed)) {
      conversations.set(key, { messages: data.messages || [], unread: data.unread || 0 });
    }
  }
  if (!conversations.has('general')) {
    conversations.set('general', { messages: [], unread: 0 });
  }
}

function saveConversations() {
  const data = {};
  for (const [key, value] of conversations.entries()) {
    data[key] = { messages: value.messages, unread: value.unread };
  }
  localStorage.setItem('quickchat_conversations', JSON.stringify(data));
}

// Afficher une conversation
function showConversation(key) {
  currentConversation = key;
  chatDiv.innerHTML = '';
  
  const conv = conversations.get(key) || { messages: [] };
  conv.messages.forEach(msg => displayMessage(msg.text, msg.id, msg.timestamp, msg.media, msg.audio, msg.sender));

  // Mettre à jour l'UI
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

  // Réinitialiser les non-lus
  conv.unread = 0;
  updateUnreadCount(key);
  saveConversations();
}

// Ajouter une conversation privée dans la liste
function addPrivateConversation(target) {
  const key = `private:${target}`;
  if (!conversations.has(key)) {
    conversations.set(key, { messages: [], unread: 0 });
    saveConversations();
  }

  // Ajouter dans la liste UI
  if (!document.querySelector(`.conv-item[data-conv="${key}"]`)) {
    const li = document.createElement('li');
    li.className = 'conv-item';
    li.dataset.conv = key;
    li.textContent = `👤 ${target}`;
    li.onclick = () => showConversation(key);
    convList.appendChild(li);
  }
}

function updateUnreadCount(key) {
  const conv = conversations.get(key);
  const item = document.querySelector(`.conv-item[data-conv="${key}"]`);
  if (item && conv && conv.unread > 0) {
    item.textContent = `👤 ${key.split(':')[1]} (${conv.unread})`;
  } else if (item && key.startsWith('private:')) {
    item.textContent = `👤 ${key.split(':')[1]}`;
  }
}

// Événements
joinBtn.addEventListener('click', join);
sendBtn.addEventListener('click', send);
msgInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
msgInput.addEventListener('input', handleTyping);
recordBtn.addEventListener('click', toggleRecording);
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', sendFile);
backToGeneralBtn.addEventListener('click', () => showConversation('general'));

function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'set_pseudo', pseudo: user }));
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === 'history') {
        conversations.get('general').messages = data.messages.map(msg => ({
          text: msg, sender: extractSender(msg)
        }));
        if (currentConversation === 'general') {
          showConversation('general');
        }
        saveConversations();
      }
      else if (data.type === 'message') {
        const msgObj = { text: data.text, id: data.id, timestamp: data.timestamp, media: data.media, audio: data.audio, sender: extractSender(data.text) };
        const generalConv = conversations.get('general');
        generalConv.messages.push(msgObj);
        saveConversations();
        if (currentConversation === 'general') {
          displayMessage(data.text, data.id, data.timestamp, data.media, data.audio, msgObj.sender);
        }
        notifSound.play().catch(() => {});
        typingIndicator.textContent = '';
      }
      else if (data.type === 'private_message') {
        const from = data.from;
        const key = `private:${from}`;
        addPrivateConversation(from);

        const msgObj = { text: data.text, id: data.id, timestamp: data.timestamp, media: data.media, audio: data.audio, sender: from };
        const conv = conversations.get(key);
        conv.messages.push(msgObj);
        if (currentConversation !== key) {
          conv.unread++;
          updateUnreadCount(key);
        }
        saveConversations();

        if (currentConversation === key) {
          displayMessage(data.text, data.id, data.timestamp, data.media, data.audio, from);
        }
        notifSound.play().catch(() => {});
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
      // (tu peux garder edit/delete si tu veux — je simplifie ici)
    } catch (err) {
      console.error('Erreur:', err);
    }
  };

  socket.onclose = () => setTimeout(connectWebSocket, 3000);
}

// Afficher un message dans le chat
function displayMessage(fullMessage, id, timestamp, mediaData, audioData, sender) {
  if (!fullMessage) return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  if (id) messageDiv.dataset.id = id;

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

  chatDiv.appendChild(messageDiv);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

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

// Envoi
function send() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !msgInput.value.trim()) return;

  const text = msgInput.value.trim();
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fullMsg = `[${t}] ${user}: ${text}`;
  const id = `${user}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  if (currentConversation === 'general') {
    socket.send(JSON.stringify({ type: 'message', text: fullMsg, id, timestamp: Date.now() }));
  } else {
    const target = currentConversation.split(':')[1];
    socket.send(JSON.stringify({ type: 'private_message', to: target, text: fullMsg, id, timestamp: Date.now() }));
  }

  // Ajouter localement
  const msgObj = { text: fullMsg, id, timestamp: Date.now(), sender: user };
  const conv = conversations.get(currentConversation);
  conv.messages.push(msgObj);
  saveConversations();

  msgInput.value = '';
  if (currentConversation === 'general' && isTyping) {
    isTyping = false;
    socket.send(JSON.stringify({ type: 'stop_typing', user }));
  }
}

// Login
function join() {
  const p = pseudoInput.value.trim();
  if (p && p.length >= 2) {
    user = p;
    localStorage.setItem('quickchat_user', user);
    loadConversations();
    loginScreen.style.display = 'none';
    conversationsPanel.style.display = 'block';
    chatApp.style.display = 'block';
    connectWebSocket();
    showConversation('general');
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

// Autres fonctions (toggleRecording, sendFile, etc.) — tu peux les garder si tu veux les médias
// Pour simplifier, je les omets ici, mais tu peux les recopier depuis ton ancien script

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
