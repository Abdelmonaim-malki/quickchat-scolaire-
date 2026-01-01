let user = '';
let currentChat = 'general'; // 'general' ou 'user1-user2'
let socket = null;
let typingTimer = null;
let isTyping = false;

// Éléments DOM
const loginScreen = document.getElementById('loginScreen');
const chatApp = document.getElementById('chatApp');
const pseudoInput = document.getElementById('pseudoInput');
const loginBtn = document.getElementById('loginBtn');
const usersList = document.getElementById('usersList');
const chatHeader = document.getElementById('chatHeader');
const chat = document.getElementById('chat');
const msgInput = document.getElementById('msg');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
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
    chatApp.style.display = 'flex';
    connectWebSocket();
  } else {
    alert('Pseudo invalide (min. 2 caractères).');
  }
}

function connectWebSocket() {
  socket = new WebSocket('wss://' + window.location.host);
  
  socket.onopen = () => {
    console.log('🟢 Connecté au serveur');
    // S'authentifier
    socket.send(JSON.stringify({ type: 'auth', pseudo: user }));
  };

  socket.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      
      if (data.type === 'init') {
        // Charger historique général
        data.history.forEach(msg => addMessageToChat(msg, 'general'));
        // Ajouter utilisateurs
        data.users.forEach(u => {
          if (u !== user) addUserToList(u);
        });
      }
      else if (data.type === 'user_join') {
        if (data.user !== user) {
          addUserToList(data.user);
        }
      }
      else if (data.type === 'user_leave') {
        removeUserFromList(data.user);
      }
      else if (data.type === 'message') {
        if (data.target === 'general') {
          if (currentChat === 'general') {
            addMessageToChat(data.text, 'general');
            notifSound.play().catch(() => {});
          }
        } else {
          // Message privé
          const room = data.target;
          const otherUser = getOtherUser(room);
          if (currentChat === room) {
            addMessageToChat(data.text, 'private', otherUser);
            notifSound.play().catch(() => {});
          }
        }
      }
      else if (data.type === 'clear_all') {
        if (currentChat === 'general') {
          chat.innerHTML = '';
          alert('🗑️ La conversation générale a été effacée.');
        }
      }
      else if (data.type === 'typing') {
        if (currentChat === `general` || currentChat === getPrivateRoom(user, data.user)) {
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

function getPrivateRoom(u1, u2) {
  return [u1, u2].sort().join('-');
}

function getOtherUser(room) {
  const users = room.split('-');
  return users[0] === user ? users[1] : users[0];
}

function addUserToList(pseudo) {
  // Éviter les doublons
  if (document.querySelector(`[data-user="${pseudo}"]`)) return;
  
  const userItem = document.createElement('div');
  userItem.className = 'user-item';
  userItem.dataset.user = pseudo;
  userItem.textContent = pseudo;
  userItem.onclick = () => switchToPrivateChat(pseudo);
  usersList.appendChild(userItem);
}

function removeUserFromList(pseudo) {
  const userItem = document.querySelector(`[data-user="${pseudo}"]`);
  if (userItem) userItem.remove();
  
  // Si la conversation active est avec cet utilisateur, revenir au général
  if (currentChat === getPrivateRoom(user, pseudo)) {
    switchToGeneral();
  }
}

function switchToGeneral() {
  currentChat = 'general';
  chatHeader.textContent = '💬 Général';
  chat.innerHTML = '';
  // Recharger historique général (optionnel)
  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  document.querySelector('[data-user="general"]').classList.add('active');
}

function switchToPrivateChat(target) {
  currentChat = getPrivateRoom(user, target);
  chatHeader.textContent = `🔒 Conversation privée avec ${target}`;
  chat.innerHTML = '';
  // Ici, tu pourrais charger l'historique privé (optionnel)
  document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
  const targetItem = document.querySelector(`[data-user="${target}"]`);
  if (targetItem) targetItem.classList.add('active');
}

function addMessageToChat(fullMessage, type, sender) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type === 'private' ? 'private' : ''}`;
  
  // Déterminer si c'est ton message
  const isOwn = fullMessage.includes(`] ${user}:`);
  messageDiv.classList.add(isOwn ? 'own' : 'other');
  
  messageDiv.textContent = fullMessage;
  chat.appendChild(messageDiv);
  chat.scrollTop = messageDiv.offsetTop;
}

function handleTyping() {
  if (!isTyping && user && currentChat === 'general') {
    isTyping = true;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'typing',
        user: user
      }));
    }
  }
  // Pour les conversations privées, on ne gère pas le typing (optionnel)
  
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (isTyping) {
      isTyping = false;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'stop_typing',
          user: user
        }));
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
    const otherUser = getOtherUser(currentChat);
    socket.send(JSON.stringify({
      type: 'message',
      text: fullMsg,
      target: otherUser,
      sender: user
    }));
  }
  msgInput.value = '';
  typingIndicator.textContent = ''; // Effacer l'indicateur
}

// Éviter le drag/drop sur la liste des utilisateurs
usersList.addEventListener('dragstart', (e) => e.preventDefault());
