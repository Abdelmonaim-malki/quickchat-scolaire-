let user = '';
let currentChat = 'general'; // 'general' ou 'user1-user2'
let socket = null;
let typingTimer = null;
let isTyping = false;
let unreadPrivateMessages = new Set(); // Pour les badges rouges

// Éléments DOM
const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const pseudoInput = document.getElementById('pseudoInput');
const loginBtn = document.getElementById('loginBtn');
const chat = document.getElementById('chat');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const usersListEl = document.getElementById('usersList');
const notifSound = document.getElementById('notif-sound');

// Événements
loginBtn.addEventListener('click', handleLogin);
msgInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});
msgInput.addEventListener('input', handleTyping);
sendBtn.addEventListener('click', sendMessage);

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
        // Historique général
        data.history.forEach(msg => addMessage(msg, 'general'));
        // Liste des utilisateurs
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
            addMessage(data.text, 'general');
            notifSound.play().catch(() => {});
          }
        } else {
          // Message privé
          const otherUser = data.sender === user ? data.receiver : data.sender;
          const room = getPrivateRoom(user, otherUser);
          
          // Marquer comme non lu si ce n'est pas la conversation active
          if (currentChat !== room) {
            unreadPrivateMessages.add(otherUser);
          }
          
          if (currentChat === room) {
            addMessage(data.text, 'private', otherUser);
            notifSound.play().catch(() => {});
          }
          updateUserList(getOnlineUsers()); // Met à jour les badges
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
    span.style.margin = '0 5px';
    
    // Badge rouge si message non lu
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
      // Effacer le badge
      unreadPrivateMessages.delete(u);
      currentChat = getPrivateRoom(user, u);
      chat.innerHTML = '';
      chatHeader = `🔒 Conversation avec ${u}`;
      updateUserList(users); // Rafraîchir la liste
    };

    usersListEl.appendChild(span);
  });
}

function addMessage(fullMessage, type, sender) {
  if (!fullMessage || typeof fullMessage !== 'string') return;

  const messageDiv = document.createElement('div');
  messageDir.className = 'message';
  
  const match = fullMessage.match(/(\[.*?\]\s*.*?:)\s*(.*)/);
  if (match) {
    const senderName = match[1].split('] ')[1].replace(':', '');
    const color = stringToColor(senderName);
    messageDiv.innerHTML = `<span class="sender" style="color:${color}">${match[1]}</span> ${match[2]}`;
  } else {
    messageDiv.textContent = fullMessage;
  }

  // Médias (si présents dans le texte)
  const urlRegex = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif|mp4|webm))/gi;
  const mediaMatch = fullMessage.match(urlRegex);
  if (mediaMatch) {
    const url = mediaMatch[0];
    if (url.match(/\.(mp4|webm)$/)) {
      messageDiv.innerHTML += `<br><video src="${url}" controls width="200"></video>`;
    } else {
      messageDiv.innerHTML += `<br><img src="${url}" style="max-width:200px;">`;
    }
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

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fullMsg = `[${time}] ${user}: ${msg}`;

  if (currentChat === 'general') {
    socket.send(JSON.stringify({
      type: 'message',
      text: fullMsg,
      target: 'general',
      sender: user
    }));
  } else {
    const otherUser = currentChat.replace(user + '-', '').replace('-' + user, '');
    socket.send(JSON.stringify({
      type: 'message',
      text: fullMsg,
      target: otherUser,
      sender: user
    }));
  }
  msgInput.value = '';
  typingIndicator.textContent = '';
}
