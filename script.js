let user = '';
let currentChat = 'general';
let socket = null;
let typingTimer = null;
let isTyping = false;
let unreadPrivateMessages = new Set();
const privateHistories = {};

const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const pseudoInput = document.getElementById('pseudoInput');
const loginBtn = document.getElementById('loginBtn');
const chat = document.getElementById('chat');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('sendBtn');
const recordBtn = document.getElementById('recordBtn');
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
const backToGeneralBtn = document.getElementById('backToGeneralBtn');
const typingIndicator = document.getElementById('typingIndicator');
const usersListEl = document.getElementById('usersList');
const notifSound = document.getElementById('notif-sound');

let mediaRecorder;
let audioChunks = [];

loginBtn.addEventListener('click', handleLogin);
msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});
msgInput.addEventListener('input', handleTyping);
sendBtn.addEventListener('click', sendMessage);
recordBtn.addEventListener('click', toggleRecording);
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', sendFile);
backToGeneralBtn.addEventListener('click', switchToGeneral);

function handleLogin() {
  const pseudo = pseudoInput.value.trim();
  if (pseudo && pseudo.length >= 2) {
    user = pseudo;
    loginScreen.style.display = 'none';
    chatApp.style.display = 'block';
    connectWebSocket();
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'auth', pseudo: user }));
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      
      if (data.type === 'init') {
        data.history.forEach(msg => addMessage(msg, 'general'));
        updateUserList(data.users);
      }
      else if (data.type === 'user_join') {
        updateUserList(Array.from(new Set([...getOnlineUsers(), data.user])));
      }
      else if (data.type === 'user_leave') {
        updateUserList(getOnlineUsers().filter(u => u !== data.user));
      }
      else if (data.type === 'message') {
        if (data.target === 'general') {
          if (currentChat === 'general') {
            addMessage(data.text, 'general', null, data.audio, data.media);
            notifSound.play().catch(() => {});
          }
        } else {
          const otherUser = data.sender === user ? data.receiver : data.sender;
          const room = getPrivateRoom(user, otherUser);
          
          if (!privateHistories[room]) privateHistories[room] = [];
          privateHistories[room].push({
            text: data.text,
            audio: data.audio,
            media: data.media
          });
          
          if (currentChat === room) {
            addMessage(data.text, 'private', otherUser, data.audio, data.media);
            notifSound.play().catch(() => {});
            unreadPrivateMessages.delete(otherUser);
          } else {
            unreadPrivateMessages.add(otherUser);
          }
          updateUserList(getOnlineUsers());
        }
      }
      else if (data.type === 'private_history') {
        if (currentChat === data.room) {
          const otherUser = getOtherUser(data.room);
          data.history.forEach(item => {
            addMessage(item.text, 'private', otherUser, item.audio, item.media);
          });
          privateHistories[data.room] = data.history;
        }
      }
      else if (data.type === 'clear_all') {
        if (currentChat === 'general') {
          chat.innerHTML = '';
          alert('🗑️ La conversation a été effacée.');
        }
      }
      else if (data.type === 'typing') {
        if (currentChat === 'general') {
          typingIndicator.textContent = `${data.user} est en train d’écrire...`;
        }
      }
      else if (data.type === 'stop_typing') {
        typingIndicator.textContent = '';
      }
    } catch (err) {
      console.error('Erreur message:', err);
    }
  };

  socket.onclose = () => {
    setTimeout(() => {
      if (user) connectWebSocket();
    }, 3000);
  };
}

function getPrivateRoom(u1, u2) {
  return [u1, u2].sort().join('-');
}

function getOtherUser(room) {
  const users = room.split('-');
  return users[0] === user ? users[1] : users[0];
}

function getOnlineUsers() {
  const users = [];
  document.querySelectorAll('.user-online').forEach(el => {
    users.push(el.dataset.user);
  });
  return users;
}

function updateUserList(users) {
  usersListEl.innerHTML = '';
  if (users.length === 0) {
    usersListEl.textContent = 'Aucun';
    return;
  }

  users.forEach(u => {
    const span = document.createElement('span');
    span.className = 'user-online';
    span.dataset.user = u;
    span.textContent = u;
    span.style.cursor = 'pointer';
    span.style.margin = '0 3px';
    
    if (unreadPrivateMessages.has(u)) {
      span.style.position = 'relative';
      const badge = document.createElement('span');
      badge.style.color = 'red';
      badge.style.position = 'absolute';
      badge.style.top = '-8px';
      badge.style.right = '-10px';
      badge.textContent = '•';
      badge.style.fontSize = '1.5em';
      span.appendChild(badge);
    }

    span.onclick = () => {
      switchToPrivateChat(u);
    };

    usersListEl.appendChild(span);
  });
}

function updateHeader() {
  if (currentChat === 'general') {
    backToGeneralBtn.style.display = 'none';
  } else {
    backToGeneralBtn.style.display = 'inline-block';
  }
}

function switchToGeneral() {
  currentChat = 'general';
  chat.innerHTML = '';
  updateHeader();
  updateUserList(getOnlineUsers());
}

function switchToPrivateChat(targetUser) {
  currentChat = getPrivateRoom(user, targetUser);
  chat.innerHTML = '';
  
  const room = currentChat;
  if (privateHistories[room] && privateHistories[room].length > 0) {
    privateHistories[room].forEach(item => {
      addMessage(item.text, 'private', targetUser, item.audio, item.media);
    });
  } else {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'get_private_history',
        room: room
      }));
    }
  }
  
  updateHeader();
  updateUserList(getOnlineUsers());
}

function addMessage(fullMessage, type, sender, audioData, mediaData) {
  if (!fullMessage || typeof fullMessage !== 'string') return;

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  
  const match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
  if (match) {
    const senderName = match[1].split('] ')[1].replace(':', '');
    const color = stringToColor(senderName);
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
      mediaElement.style.width = '200px';
    } else {
      mediaElement.style.maxWidth = '200px';
      mediaElement.style.borderRadius = '5px';
    }
    mediaElement.src = mediaData;
    messageDiv.appendChild(document.createElement('br'));
    messageDiv.appendChild(mediaElement);
  }

  const isOwnMessage = fullMessage.includes(`] ${user}:`);
  if (isOwnMessage) {
    const dots = document.createElement('span');
    dots.className = 'dots';
    dots.innerHTML = '⋮';
    dots.onclick = (e) => {
      e.stopPropagation();
      showActionsMenu(messageDiv, fullMessage);
    };
    messageDiv.appendChild(dots);
  }

  chat.appendChild(messageDiv);
  chat.scrollTop = messageDiv.offsetTop;
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

function showActionsMenu(messageDiv, fullMessage) {
  document.querySelectorAll('.message-actions-menu').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'message-actions-menu';
  
  const editBtn = document.createElement('button');
  editBtn.innerHTML = '✏️ Modifier';
  editBtn.onclick = () => {
    editMessage(messageDiv, fullMessage);
    menu.remove();
  };
  menu.appendChild(editBtn);

  const deleteForMe = document.createElement('button');
  deleteForMe.innerHTML = '🗑️ Supprimer pour moi';
  deleteForMe.onclick = () => {
    messageDiv.remove();
    menu.remove();
  };
  menu.appendChild(deleteForMe);

  const deleteForAll = document.createElement('button');
  deleteForAll.innerHTML = '🌍 Supprimer pour tous';
  deleteForAll.onclick = () => {
    if (confirm('Supprimer ce message pour TOUS ?')) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'delete_for_all',
          id: Date.now(),
          originalPrefix: fullMessage.split('] ')[0] + '] '
        }));
        messageDiv.remove();
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

function editMessage(messageDiv, oldMessage) {
  const content = oldMessage.split(': ').slice(1).join(': ');
  const newText = prompt('Modifier le message :', content);
  if (newText !== null && newText.trim() !== '') {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const updatedMsg = oldMessage.replace(/: .*/, `: ${newText.trim()}`);
    
    if (currentChat === 'general') {
      sendMessageRaw(updatedMsg);
    } else {
      const otherUser = getOtherUser(currentChat);
      sendMessageRaw(updatedMsg, otherUser);
    }
    
    const match = updatedMsg.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
    if (match) {
      messageDiv.innerHTML = `<span class="sender" style="color:${stringToColor(match[1].split('] ')[1].replace(':', ''))}">${match[1]}</span> ${match[2]} <span style="font-size:0.8em;color:#666;">(✏️ modifié)</span>`;
    }
  }
}

function handleTyping() {
  if (!isTyping && user && currentChat === 'general') {
    isTyping = true;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'typing', user: user }));
    }
  }
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

function sendMessage() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Connexion perdue.');
    return;
  }

  const msg = msgInput.value.trim();
  if (!msg) return;

  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fullMsg = `[${t}] ${user}: ${msg}`;

  if (currentChat === 'general') {
    sendMessageRaw(fullMsg);
  } else {
    const otherUser = getOtherUser(currentChat);
    sendMessageRaw(fullMsg, otherUser);
  }
  msgInput.value = '';
  typingIndicator.textContent = '';
}

function sendMessageRaw(fullMsg, targetUser = null) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    alert('Connexion perdue.');
    return;
  }

  if (targetUser) {
    socket.send(JSON.stringify({
      type: 'message',
      text: fullMsg,
      target: targetUser,
      sender: user
    }));
  } else {
    socket.send(JSON.stringify({
      type: 'message',
      text: fullMsg,
      target: 'general',
      sender: user
    }));
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
          if (currentChat === 'general') {
            sendMessageRaw(msg, null, reader.result);
          } else {
            const otherUser = getOtherUser(currentChat);
            sendMessageRaw(msg, otherUser, reader.result);
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
    if (currentChat === 'general') {
      sendMessageRaw(msg, null, null, e.target.result);
    } else {
      const otherUser = getOtherUser(currentChat);
      sendMessageRaw(msg, otherUser, null, e.target.result);
    }
    fileInput.value = '';
  };
  reader.readAsDataURL(file);
}
