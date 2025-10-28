// ═══════════════════════════════════════════════════════════════
// Cold Room Chat System V2 - Complete Client (Final)
// ═══════════════════════════════════════════════════════════════
console.log('❄️ Cold Room V2 loading...');

let socket = null;
let currentUser = null;
let currentRoom = null;
let systemSettings = {};
let selectedUserId = null;
let selectedUsername = null;
let currentPrivateChatUser = null;
let selectedMuted = [];
let selectedBanned = [];
let confirmCallback = null;
let editingRoomId = null;
let ytPlayer = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 5;

// ═══════════════════════════════════════════════════════════════
// SOCKET INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function initializeSocket() {
    console.log('🔌 Connecting...');
    
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: maxReconnectAttempts,
        timeout: 20000,
        forceNew: true
    });

    setupSocketListeners();
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('✅ Connected');
        reconnectAttempts = 0;
        hideLoading();
        
        if (currentUser && currentRoom) {
            console.log('🔄 Reconnecting...');
            socket.emit('join-room', { roomId: currentRoom });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('⚠️ Disconnected:', reason);
        if (reason === 'io server disconnect') {
            socket.connect();
        }
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error);
        reconnectAttempts++;
        
        if (reconnectAttempts >= maxReconnectAttempts) {
            showAlert('Connection lost. Please refresh.', 'error');
        }
    });

    socket.on('login-success', (data) => {
        handleLoginSuccess(data);
    });

    socket.on('login-error', (message) => {
        hideLoading();
        showAlert(message, 'error');
    });

    socket.on('banned-user', (data) => {
        hideLoading();
        showAlert(`You are banned: ${data.reason}`, 'error');
        document.getElementById('support-section').style.display = 'block';
    });

    socket.on('register-success', (data) => {
        hideLoading();
        showAlert(data.message, 'success');
        document.getElementById('login-username').value = data.username;
    });

    socket.on('register-error', (message) => {
        hideLoading();
        showAlert(message, 'error');
    });

    socket.on('new-message', (message) => {
        if (message.roomId === currentRoom) {
            addMessage(message);
            scrollToBottom();
        }
    });

    socket.on('message-edited', (data) => {
        const msgEl = document.querySelector(`[data-message-id="${data.messageId}"] .message-text`);
        if (msgEl) {
            msgEl.textContent = data.newText + ' (edited)';
        }
    });

    socket.on('new-private-message', (message) => {
        if (currentPrivateChatUser === message.from) {
            addPrivateMessage(message);
        }
        showNotification(`New message from ${message.fromName}`);
    });

    socket.on('private-message-sent', (message) => {
        addPrivateMessage(message);
    });

    socket.on('private-messages-list', (data) => {
        displayPrivateMessages(data.messages, data.withUserId);
    });

    socket.on('room-joined', (data) => {
        handleRoomJoined(data);
    });

    socket.on('room-created', (data) => {
        showAlert('Room created', 'success');
        socket.emit('join-room', { roomId: data.roomId });
        hideModal('create-room-modal');
    });

    socket.on('room-updated', (data) => {
        if (socket.currentRoom === editingRoomId) {
            document.getElementById('room-info').textContent = data.name;
        }
        showNotification('Room updated');
    });

    socket.on('users-list', updateUsersList);
    socket.on('rooms-list', updateRoomsList);

    socket.on('user-joined', (data) => {
        showNotification(`${data.username} joined`);
    });

    socket.on('message-deleted', (data) => {
        const msgEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (msgEl) msgEl.remove();
    });

    socket.on('chat-cleaned', (data) => {
        clearMessages();
        showAlert(data.message, 'info');
    });

    socket.on('room-silenced', (data) => {
        document.getElementById('message-input').disabled = !currentUser?.isOwner;
        showAlert(data.message, 'warning');
    });

    socket.on('room-unsilenced', (data) => {
        document.getElementById('message-input').disabled = false;
        showAlert(data.message, 'success');
    });

    socket.on('room-deleted', (data) => {
        showAlert(data.message, 'error');
        socket.emit('join-room', { roomId: 'global_cold' });
    });

    socket.on('party-mode-changed', (data) => {
        togglePartyEffects(data.enabled);
        showNotification(data.enabled ? '🎉 Party Mode ON!' : 'Party Mode OFF');
    });

    socket.on('youtube-started', (data) => {
        showYouTubePlayer(data.videoId);
        showNotification(`${data.startedBy} started a video`);
    });

    socket.on('youtube-stopped', () => {
        hideYouTubePlayer();
    });

    socket.on('action-success', (message) => {
        showAlert(message, 'success');
    });

    socket.on('error', (message) => {
        showAlert(message, 'error');
    });

    socket.on('message-error', (message) => {
        showAlert(message, 'error');
    });

    socket.on('banned', (data) => {
        showAlert(`You have been banned: ${data.reason}`, 'error');
        setTimeout(() => logout(true), 3000);
    });

    socket.on('account-deleted', (data) => {
        showAlert(data.message, 'error');
        setTimeout(() => logout(true), 2000);
    });

    socket.on('settings-updated', (settings) => {
        systemSettings = settings;
        applySiteSettings();
        showAlert('Settings updated', 'info');
    });

    socket.on('support-message-sent', (data) => {
        showAlert(data.message, 'success');
    });

    socket.on('support-messages-list', (messages) => {
        displaySupportMessages(messages);
    });

    socket.on('muted-list', (list) => {
        displayMutedList(list);
    });

    socket.on('banned-list', (list) => {
        displayBannedList(list);
    });
}

// ═══════════════════════════════════════════════════════════════
// LOGIN & REGISTER
// ═══════════════════════════════════════════════════════════════

function handleLoginSuccess(data) {
    currentUser = data.user;
    currentRoom = data.room.id;
    systemSettings = data.systemSettings;

    document.getElementById('current-user-name').textContent = currentUser.displayName;
    document.getElementById('current-user-avatar').textContent = currentUser.avatar;
    updateUserBadges();

    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('chat-screen').classList.add('active');

    stopLoginMusic();
    playChatMusic();

    hideLoading();
    showAlert(`Welcome ${currentUser.displayName}! ❄️`, 'success');

    clearMessages();
    data.room.messages.forEach(msg => addMessage(msg));

    document.getElementById('message-input').disabled = false;
    document.querySelector('#message-form button').disabled = false;

    socket.emit('get-rooms');
    socket.emit('get-users', { roomId: currentRoom });

    if (currentUser.isOwner) {
        document.getElementById('owner-panel-btn').style.display = 'inline-block';
        document.getElementById('owner-tools').style.display = 'flex';
    }

    if (data.room.partyMode) {
        togglePartyEffects(true);
    }

    applySiteSettings();
    startHeartbeat();
    createSnowfall();
    drawSnowman();
}

function handleRoomJoined(data) {
    currentRoom = data.room.id;
    document.getElementById('room-info').textContent = data.room.name;
    
    clearMessages();
    data.room.messages.forEach(msg => addMessage(msg));
    
    document.getElementById('message-input').disabled = false;
    document.querySelector('#message-form button').disabled = false;
    
    if (data.room.partyMode) {
        togglePartyEffects(true);
    } else {
        togglePartyEffects(false);
    }
    
    socket.emit('get-users', { roomId: currentRoom });
    scrollToBottom();
}

window.login = function() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!username || !password) {
        showAlert('Please enter username and password', 'error');
        return;
    }

    showLoading('Logging in...');
    socket.emit('login', { username, password });
};

window.register = function() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const displayName = document.getElementById('register-displayname').value.trim();
    const gender = document.getElementById('register-gender').value;

    if (!username || !password || !displayName || !gender) {
        showAlert('Please fill all fields', 'error');
        return;
    }

    if (username.length < 3 || username.length > 20) {
        showAlert('Username: 3-20 characters', 'error');
        return;
    }

    if (password.length < 6) {
        showAlert('Password: 6+ characters', 'error');
        return;
    }

    showLoading('Creating account...');
    socket.emit('register', { username, password, displayName, gender });
};

window.sendSupportMessage = function() {
    const message = document.getElementById('support-message').value.trim();
    
    if (!message) {
        showAlert('Please write your message', 'error');
        return;
    }

    socket.emit('send-support-message', {
        from: document.getElementById('login-username').value || 'Anonymous',
        message: message
    });

    document.getElementById('support-message').value = '';
};

window.logout = function(forced = false) {
    if (forced || confirm('Are you sure you want to logout?')) {
        showLoading('Logging out...');
        if (socket) socket.disconnect();
        setTimeout(() => location.reload(), 1000);
    }
};

// ═══════════════════════════════════════════════════════════════
// SEND MESSAGES
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
    const messageForm = document.getElementById('message-form');
    if (messageForm) {
        messageForm.addEventListener('submit', function(e) {
            e.preventDefault();
            sendMessage();
        });
    }

    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    document.getElementById('login-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });
});

function sendMessage() {
    const textarea = document.getElementById('message-input');
    const text = textarea.value.trim();

    if (!text) return;

    if (!socket || !socket.connected) {
        showAlert('Connection lost. Reconnecting...', 'error');
        socket.connect();
        return;
    }

    socket.emit('send-message', { text: text, roomId: currentRoom });
    textarea.value = '';
}

function editMessage(messageId, currentText) {
    const newText = prompt('Edit your message:', currentText);
    if (newText && newText.trim() !== currentText) {
        socket.emit('edit-message', {
            messageId: messageId,
            newText: newText.trim()
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// IMAGE & VIDEO UPLOAD (Owner Only)
// ═══════════════════════════════════════════════════════════════

window.showImageUpload = function() {
    document.getElementById('image-upload-modal').classList.add('active');
};

window.sendImageMessage = function() {
    const imageUrl = document.getElementById('image-url-input').value.trim();
    
    if (!imageUrl) {
        showAlert('Please enter image URL', 'error');
        return;
    }

    socket.emit('send-image', { imageUrl: imageUrl });
    document.getElementById('image-url-input').value = '';
    hideModal('image-upload-modal');
};

window.showVideoUpload = function() {
    document.getElementById('video-upload-modal').classList.add('active');
};

window.sendVideoMessage = function() {
    const videoUrl = document.getElementById('video-url-input').value.trim();
    
    if (!videoUrl) {
        showAlert('Please enter video URL (MP4)', 'error');
        return;
    }

    if (!videoUrl.toLowerCase().endsWith('.mp4')) {
        showAlert('Please enter a valid MP4 video URL', 'error');
        return;
    }

    socket.emit('send-video', { videoUrl: videoUrl });
    document.getElementById('video-url-input').value = '';
    hideModal('video-upload-modal');
};

// ═══════════════════════════════════════════════════════════════
// DISPLAY MESSAGES
// ═══════════════════════════════════════════════════════════════

function addMessage(message) {
    const container = document.getElementById('messages');
    if (!container) return;

    const welcomeMsg = container.querySelector('.welcome-message');
    if (welcomeMsg) welcomeMsg.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.isOwner ? 'owner-message' : ''}`;
    messageDiv.setAttribute('data-message-id', message.id);

    let badges = '';
    if (message.isOwner) {
        badges += '<span class="badge owner-badge">👑</span>';
    } else if (message.isModerator) {
        badges += '<span class="badge moderator-badge">⭐</span>';
    }

    if (message.isVideo) {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div>
                    <span class="message-user">${escapeHtml(message.avatar)} ${escapeHtml(message.username)}</span>
                    ${badges}
                </div>
            </div>
            <div class="message-video">
                <video controls style="max-width: 500px; max-height: 400px; border-radius: 10px;">
                    <source src="${escapeHtml(message.videoUrl)}" type="video/mp4">
                    Your browser does not support video playback.
                </video>
            </div>
            <div class="message-footer">
                <span class="message-time">${message.timestamp}</span>
            </div>
        `;
    } else if (message.isImage) {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div>
                    <span class="message-user">${escapeHtml(message.avatar)} ${escapeHtml(message.username)}</span>
                    ${badges}
                </div>
            </div>
            <div class="message-image">
                <img src="${escapeHtml(message.imageUrl)}" alt="Image" style="max-width: 400px; border-radius: 10px;">
            </div>
            <div class="message-footer">
                <span class="message-time">${message.timestamp}</span>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div>
                    <span class="message-user">${escapeHtml(message.avatar)} ${escapeHtml(message.username)}</span>
                    ${badges}
                </div>
            </div>
            <div class="message-text">${escapeHtml(message.text)}${message.edited ? ' <small>(edited)</small>' : ''}</div>
            <div class="message-footer">
                <span class="message-time">${message.timestamp}</span>
            </div>
        `;
    }

    if (message.userId !== currentUser?.id || currentUser?.isOwner) {
        messageDiv.style.cursor = 'pointer';
        messageDiv.addEventListener('click', (e) => {
            if (!e.target.closest('.badge') && !e.target.closest('video') && !e.target.closest('img')) {
                selectedUserId = message.userId;
                selectedUsername = message.username;
                showMessageActions(message);
            }
        });
    }

    container.appendChild(messageDiv);
    scrollToBottom();
}

function showMessageActions(message) {
    const actions = [];

    // Own message
    if (message.userId === currentUser?.id && !message.isImage && !message.isVideo) {
        actions.push({ 
            text: '✏️ Edit My Message', 
            action: () => editMessage(message.id, message.text)
        });
    }

    // Everyone can change their name
    if (message.userId === currentUser?.id) {
        actions.push({ 
            text: '📝 Change My Name', 
            action: () => changeName()
        });
    }

    // Owner actions
    if (currentUser?.isOwner) {
        if (message.userId !== currentUser.id) {
            actions.push({ text: '👑 Add Moderator', action: () => addModerator() });
            actions.push({ text: '⭐ Remove Moderator', action: () => removeModerator() });
            actions.push({ text: '🔇 Mute User', action: () => showMuteDialog() });
            actions.push({ text: '🚫 Ban User', action: () => banUser() });
            actions.push({ text: '🗑️ Delete Account', action: () => deleteAccount() });
        }
        actions.push({ text: '❌ Delete Message', action: () => deleteMessage(message.id) });
    } 
    // Moderator actions
    else if (currentUser?.isModerator && message.userId !== currentUser.id) {
        actions.push({ text: '🔇 Mute User', action: () => showMuteDialog() });
    }

    // Everyone can send PM
    if (message.userId !== currentUser?.id) {
        actions.push({ text: '💬 Private Message', action: () => openPrivateChat(selectedUserId) });
    }

    actions.push({ text: '❌ Cancel', action: () => {} });

    showActionsMenu(actions);
}

function showActionsMenu(actions) {
    const menu = document.getElementById('message-actions-menu');
    const list = document.getElementById('message-actions-list');
    
    list.innerHTML = '';
    
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'action-menu-btn';
        btn.textContent = action.text;
        btn.onclick = () => {
            menu.style.display = 'none';
            action.action();
        };
        list.appendChild(btn);
    });

    menu.style.display = 'flex';

    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target) && !e.target.closest('.message')) {
                menu.style.display = 'none';
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 100);
}

// ═══════════════════════════════════════════════════════════════
// USER ACTIONS
// ═══════════════════════════════════════════════════════════════

window.changeName = function() {
    const newName = prompt('Enter new display name:', currentUser.displayName);
    if (newName && newName.trim()) {
        socket.emit('change-display-name', { newName: newName.trim() });
        currentUser.displayName = newName.trim();
        document.getElementById('current-user-name').textContent = newName.trim();
    }
};

window.showMuteDialog = function() {
    const duration = prompt(`Mute ${selectedUsername} for how many minutes?\n\nEnter 0 for permanent mute:`, '10');
    if (duration === null) return;
    
    const durationNum = parseInt(duration);
    const isPermanent = durationNum === 0;
    
    const reason = prompt('Reason for mute:', 'Violation of chat rules');
    if (!reason) return;

    socket.emit('mute-user', {
        userId: selectedUserId,
        username: selectedUsername,
        duration: durationNum,
        reason: reason,
        roomId: currentRoom
    });
};

window.banUser = function() {
    showConfirm(
        `Ban ${selectedUsername} permanently?\n\nThis will:\n• Ban their IP address\n• Kick them immediately\n• Prevent them from returning\n\nAre you sure?`,
        (confirmed) => {
            if (confirmed) {
                const reason = prompt('Reason for ban:', 'Serious rule violation');
                if (reason) {
                    socket.emit('ban-user', {
                        userId: selectedUserId,
                        username: selectedUsername,
                        reason: reason
                    });
                }
            }
        }
    );
};

window.deleteAccount = function() {
    showConfirm(
        `⚠️ DELETE ACCOUNT: ${selectedUsername}?\n\nThis will:\n• Delete ALL their messages\n• Remove from all rooms\n• Permanently delete account\n\n⚠️ THIS CANNOT BE UNDONE!`,
        (confirmed) => {
            if (confirmed) {
                socket.emit('delete-account', {
                    userId: selectedUserId
                });
            }
        }
    );
};

window.addModerator = function() {
    if (!confirm(`Add ${selectedUsername} as a moderator?\n\nModerators can mute users.`)) return;
    
    socket.emit('add-moderator', {
        userId: selectedUserId,
        username: selectedUsername,
        roomId: currentRoom
    });
};

window.removeModerator = function() {
    if (!confirm(`Remove ${selectedUsername} from moderators?`)) return;
    
    socket.emit('remove-moderator', {
        userId: selectedUserId,
        username: selectedUsername,
        roomId: currentRoom
    });
};

function deleteMessage(messageId) {
    socket.emit('delete-message', {
        messageId: messageId,
        roomId: currentRoom
    });
}

function openPrivateChat(userId) {
    currentPrivateChatUser = userId;
    socket.emit('get-private-messages', { withUserId: userId });
    document.getElementById('private-messages-modal').classList.add('active');
    
    const user = Array.from(document.querySelectorAll('.user-item'))
        .find(el => el.dataset.userId === userId);
    
    if (user) {
        document.getElementById('private-header').textContent = `Chat with ${user.dataset.userName}`;
    }
}

// Continue in Part 2...
// ═══════════════════════════════════════════════════════════════
// Cold Room V2 - Script Part 2 (Continuation)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// PRIVATE MESSAGES
// ═══════════════════════════════════════════════════════════════

window.showPrivateMessages = function() {
    document.getElementById('private-messages-modal').classList.add('active');
    loadPrivateUsersList();
};

function loadPrivateUsersList() {
    const container = document.getElementById('private-users-list');
    socket.emit('get-users', { roomId: currentRoom });
    
    socket.once('users-list', (users) => {
        container.innerHTML = '';
        users.forEach(user => {
            if (user.id === currentUser?.id) return;
            
            const div = document.createElement('div');
            div.className = 'private-user-item';
            div.dataset.userId = user.id;
            div.dataset.userName = user.displayName;
            div.innerHTML = `
                <span>${user.avatar}</span>
                <span>${escapeHtml(user.displayName)}</span>
            `;
            div.onclick = () => openPrivateChat(user.id);
            container.appendChild(div);
        });
    });
}

window.sendPrivateMessage = function() {
    const input = document.getElementById('private-message-input');
    const text = input.value.trim();
    
    if (!text || !currentPrivateChatUser) return;

    socket.emit('send-private-message', {
        toUserId: currentPrivateChatUser,
        text: text
    });

    input.value = '';
};

function displayPrivateMessages(messages, withUserId) {
    const container = document.getElementById('private-messages');
    if (!container) return;

    container.innerHTML = '';

    messages.forEach(msg => {
        const div = document.createElement('div');
        const isFromMe = msg.from === currentUser?.id;
        div.className = `message ${isFromMe ? 'my-message' : ''}`;
        div.innerHTML = `
            <div class="message-header">
                <span class="message-user">${escapeHtml(msg.fromName)}</span>
            </div>
            <div class="message-text">${escapeHtml(msg.text)}${msg.edited ? ' <small>(edited)</small>' : ''}</div>
            <div class="message-footer">
                <span class="message-time">${msg.timestamp}</span>
            </div>
        `;
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
}

function addPrivateMessage(message) {
    const container = document.getElementById('private-messages');
    if (!container) return;

    const isFromMe = message.from === currentUser?.id;
    const div = document.createElement('div');
    div.className = `message ${isFromMe ? 'my-message' : ''}`;
    div.innerHTML = `
        <div class="message-header">
            <span class="message-user">${escapeHtml(message.fromName)}</span>
        </div>
        <div class="message-text">${escapeHtml(message.text)}</div>
        <div class="message-footer">
            <span class="message-time">${message.timestamp}</span>
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
// ROOM MANAGEMENT
// ═══════════════════════════════════════════════════════════════

window.showCreateRoomModal = function() {
    document.getElementById('create-room-modal').classList.add('active');
};

window.createRoom = function() {
    const name = document.getElementById('room-name-input').value.trim();
    const description = document.getElementById('room-desc-input').value.trim();
    const password = document.getElementById('room-pass-input').value.trim();

    if (!name) {
        showAlert('Please enter room name', 'error');
        return;
    }

    socket.emit('create-room', { name, description, password });
    
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    document.getElementById('room-pass-input').value = '';
};

window.joinRoom = function(roomId) {
    const room = Array.from(document.querySelectorAll('.room-item'))
        .find(el => el.dataset.roomId === roomId);
    
    if (room && room.dataset.hasPassword === 'true') {
        const password = prompt('Enter room password:');
        if (password) {
            socket.emit('join-room', { roomId: roomId, password: password });
        }
    } else {
        socket.emit('join-room', { roomId: roomId });
    }
};

window.toggleRoomsList = function() {
    const sidebar = document.getElementById('rooms-sidebar');
    const usersSidebar = document.getElementById('users-sidebar');
    
    sidebar.classList.toggle('active');
    usersSidebar.classList.remove('active');
};

window.toggleUsersList = function() {
    const sidebar = document.getElementById('users-sidebar');
    const roomsSidebar = document.getElementById('rooms-sidebar');
    
    sidebar.classList.toggle('active');
    roomsSidebar.classList.remove('active');
};

function updateRoomsList(rooms) {
    const container = document.getElementById('rooms-list');
    if (!container) return;

    container.innerHTML = '';

    rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room-item';
        div.dataset.roomId = room.id;
        div.dataset.hasPassword = room.hasPassword;
        
        const lock = room.hasPassword ? '🔒 ' : '';
        const official = room.isOfficial ? '⭐ ' : '';

        div.innerHTML = `
            <div class="room-item-name">${official}${lock}${escapeHtml(room.name)}</div>
            <div class="room-item-desc">${escapeHtml(room.description)}</div>
            <div class="room-item-info">
                <span>👥 ${room.userCount}</span>
                <span>${escapeHtml(room.createdBy)}</span>
            </div>
        `;

        div.onclick = () => joinRoom(room.id);

        if (currentUser?.isOwner) {
            let pressTimer;
            div.addEventListener('mousedown', (e) => {
                pressTimer = setTimeout(() => showRoomActions(room.id, room.name, room.isOfficial), 500);
            });
            div.addEventListener('mouseup', () => clearTimeout(pressTimer));
            div.addEventListener('mouseleave', () => clearTimeout(pressTimer));
            
            div.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    e.preventDefault();
                    showRoomActions(room.id, room.name, room.isOfficial);
                }, 500);
            });
            div.addEventListener('touchend', () => clearTimeout(pressTimer));
        }

        container.appendChild(div);
    });
}

function showRoomActions(roomId, roomName, isOfficial) {
    const actions = [
        { text: '✏️ Edit Room', action: () => showEditRoomModal(roomId) },
        { text: '🔇 Silence Room', action: () => silenceRoom(roomId) },
        { text: '🔊 Unsilence Room', action: () => unsilenceRoom(roomId) },
        { text: '🧹 Clean Chat', action: () => cleanChat(roomId) }
    ];

    if (!isOfficial) {
        actions.push({ text: '🗑️ Delete Room', action: () => deleteRoom(roomId, roomName) });
    }

    actions.push({ text: '❌ Cancel', action: () => {} });

    showActionsMenu(actions);
}

function showEditRoomModal(roomId) {
    editingRoomId = roomId;
    document.getElementById('edit-room-modal').classList.add('active');
}

window.saveRoomEdit = function() {
    const name = document.getElementById('edit-room-name').value.trim();
    const description = document.getElementById('edit-room-desc').value.trim();
    const password = document.getElementById('edit-room-pass').value.trim();

    socket.emit('update-room', {
        roomId: editingRoomId,
        name: name,
        description: description,
        password: password || null
    });

    hideModal('edit-room-modal');
    document.getElementById('edit-room-name').value = '';
    document.getElementById('edit-room-desc').value = '';
    document.getElementById('edit-room-pass').value = '';
};

function silenceRoom(roomId) {
    socket.emit('silence-room', { roomId: roomId });
}

function unsilenceRoom(roomId) {
    socket.emit('unsilence-room', { roomId: roomId });
}

function cleanChat(roomId) {
    showConfirm('Clean all messages in this room?', (confirmed) => {
        if (confirmed) {
            socket.emit('clean-chat', { roomId: roomId });
        }
    });
}

function deleteRoom(roomId, roomName) {
    showConfirm(`Delete room "${roomName}" permanently?\n\nThis cannot be undone.`, (confirmed) => {
        if (confirmed) {
            socket.emit('delete-room', { roomId: roomId });
        }
    });
}

function updateUsersList(users) {
    const container = document.getElementById('users-list');
    if (!container) return;

    document.getElementById('users-count').textContent = users.length;
    container.innerHTML = '';

    users.forEach(user => {
        if (user.id === currentUser?.id) return;

        const div = document.createElement('div');
        div.className = 'user-item';
        div.dataset.userId = user.id;
        div.dataset.userName = user.displayName;

        let badges = '';
        if (user.isOwner) badges += '<span class="badge owner-badge">👑</span>';
        else if (user.isModerator) badges += '<span class="badge moderator-badge">⭐</span>';

        div.innerHTML = `
            <div class="user-avatar-wrapper">
                <div class="user-avatar">${escapeHtml(user.avatar)}</div>
                ${user.isOnline ? '<span class="online-indicator"></span>' : ''}
            </div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.displayName)} ${badges}</div>
            </div>
        `;

        div.onclick = () => {
            selectedUserId = user.id;
            selectedUsername = user.displayName;
            openPrivateChat(user.id);
        };

        container.appendChild(div);
    });
}

function updateUserBadges() {
    const container = document.getElementById('user-badges');
    if (!container) return;

    let badges = '';
    
    if (currentUser.isOwner) {
        badges += '<span class="badge owner-badge">👑 Owner</span>';
    }

    container.innerHTML = badges;
}

// ═══════════════════════════════════════════════════════════════
// OWNER PANEL
// ═══════════════════════════════════════════════════════════════

window.showOwnerPanel = function() {
    document.getElementById('owner-panel-modal').classList.add('active');
    switchOwnerTab('muted');
};

window.switchOwnerTab = function(tabName) {
    document.querySelectorAll('.owner-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    document.getElementById(`owner-${tabName}`).classList.add('active');
    event.target.classList.add('active');

    if (tabName === 'muted') {
        socket.emit('get-muted-list');
    } else if (tabName === 'banned') {
        socket.emit('get-banned-list');
    } else if (tabName === 'support') {
        socket.emit('get-support-messages');
    } else if (tabName === 'settings') {
        loadSettings();
    }
};

function displayMutedList(list) {
    const container = document.getElementById('muted-list');
    if (!container) return;

    container.innerHTML = '';
    selectedMuted = [];

    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No muted users</div>';
        return;
    }

    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'owner-item';

        const timeLeft = item.temporary && item.expires ? 
            Math.ceil((item.expires - Date.now()) / 60000) + ' minutes' : 'Permanent';

        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <input type="checkbox" class="muted-checkbox" data-user-id="${item.userId}" 
                           style="margin-right: 10px; cursor: pointer;">
                    <strong>${escapeHtml(item.username)}</strong><br>
                    <small>Muted by: ${escapeHtml(item.mutedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unmute('${item.userId}')">Unmute</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${escapeHtml(item.reason)}</small><br>
                <small>Duration: ${timeLeft}</small>
            </div>
        `;

        container.appendChild(div);
    });
}

function displayBannedList(list) {
    const container = document.getElementById('banned-list');
    if (!container) return;

    container.innerHTML = '';
    selectedBanned = [];

    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No banned users</div>';
        return;
    }

    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'owner-item';

        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <input type="checkbox" class="banned-checkbox" data-user-id="${item.userId}" 
                           style="margin-right: 10px; cursor: pointer;">
                    <strong>${escapeHtml(item.username)}</strong><br>
                    <small>Banned by: ${escapeHtml(item.bannedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unban('${item.userId}')">Unban</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${escapeHtml(item.reason)}</small><br>
                <small>Date: ${new Date(item.bannedAt).toLocaleString()}</small>
            </div>
        `;

        container.appendChild(div);
    });
}

function displaySupportMessages(messages) {
    const container = document.getElementById('support-messages-list');
    if (!container) return;

    container.innerHTML = '';

    if (messages.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No support messages</div>';
        return;
    }

    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'owner-item';

        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <strong>${escapeHtml(msg.from)}</strong><br>
                    <small>${new Date(msg.sentAt).toLocaleString()}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="deleteSupportMessage('${msg.id}')">Delete</button>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 10px; line-height: 1.6;">
                ${escapeHtml(msg.message)}
            </div>
        `;

        container.appendChild(div);
    });
}

window.selectAllMuted = function() {
    document.querySelectorAll('.muted-checkbox').forEach(cb => cb.checked = true);
};

window.selectAllBanned = function() {
    document.querySelectorAll('.banned-checkbox').forEach(cb => cb.checked = true);
};

window.unmuteSelected = function() {
    const selected = Array.from(document.querySelectorAll('.muted-checkbox:checked'))
        .map(cb => cb.dataset.userId);
    
    if (selected.length === 0) {
        showAlert('Please select users first', 'error');
        return;
    }

    showConfirm(`Unmute ${selected.length} users?`, (confirmed) => {
        if (confirmed) {
            socket.emit('unmute-multiple', { userIds: selected });
            setTimeout(() => socket.emit('get-muted-list'), 500);
        }
    });
};

window.unbanSelected = function() {
    const selected = Array.from(document.querySelectorAll('.banned-checkbox:checked'))
        .map(cb => cb.dataset.userId);
    
    if (selected.length === 0) {
        showAlert('Please select users first', 'error');
        return;
    }

    showConfirm(`Unban ${selected.length} users?`, (confirmed) => {
        if (confirmed) {
            socket.emit('unban-multiple', { userIds: selected });
            setTimeout(() => socket.emit('get-banned-list'), 500);
        }
    });
};

window.unmute = function(userId) {
    socket.emit('unmute-user', { userId: userId });
    setTimeout(() => socket.emit('get-muted-list'), 500);
};

window.unban = function(userId) {
    socket.emit('unban-user', { userId: userId });
    setTimeout(() => socket.emit('get-banned-list'), 500);
};

window.deleteSupportMessage = function(messageId) {
    socket.emit('delete-support-message', { messageId: messageId });
    setTimeout(() => socket.emit('get-support-messages'), 500);
};

// ═══════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════

function loadSettings() {
    document.getElementById('setting-logo').value = systemSettings.siteLogo || '';
    document.getElementById('setting-title').value = systemSettings.siteTitle || '';
    document.getElementById('setting-color').value = systemSettings.backgroundColor || 'blue';
    document.getElementById('setting-login-music').value = systemSettings.loginMusic || 'https://i.top4top.io/m_3587b7y9s1.mp3';
    document.getElementById('setting-chat-music').value = systemSettings.chatMusic || 'https://c.top4top.io/m_3586omdy81.mp3';
    document.getElementById('setting-login-volume').value = systemSettings.loginMusicVolume || 0.5;
    document.getElementById('setting-chat-volume').value = systemSettings.chatMusicVolume || 0.5;
}

window.updateLogo = function() {
    const logo = document.getElementById('setting-logo').value.trim();
    if (!logo) {
        showAlert('Please enter logo URL', 'error');
        return;
    }
    socket.emit('update-settings', { siteLogo: logo });
};

window.updateTitle = function() {
    const title = document.getElementById('setting-title').value.trim();
    if (!title) {
        showAlert('Please enter title', 'error');
        return;
    }
    socket.emit('update-settings', { siteTitle: title });
};

window.updateColor = function() {
    const color = document.getElementById('setting-color').value;
    socket.emit('update-settings', { backgroundColor: color });
};

window.updateLoginMusic = function() {
    const music = document.getElementById('setting-login-music').value.trim();
    const volume = parseFloat(document.getElementById('setting-login-volume').value);
    socket.emit('update-settings', { 
        loginMusic: music,
        loginMusicVolume: volume
    });
};

window.updateChatMusic = function() {
    const music = document.getElementById('setting-chat-music').value.trim();
    const volume = parseFloat(document.getElementById('setting-chat-volume').value);
    socket.emit('update-settings', { 
        chatMusic: music,
        chatMusicVolume: volume
    });
};

window.cleanAllRooms = function() {
    showConfirm('⚠️ Clean ALL messages in ALL rooms?\n\nThis will remove all messages permanently!', (confirmed) => {
        if (confirmed) {
            socket.emit('clean-all-rooms');
        }
    });
};

function applySiteSettings() {
    document.querySelectorAll('#main-logo, #header-logo, #site-favicon').forEach(el => {
        if (el.tagName === 'IMG') {
            el.src = systemSettings.siteLogo;
        } else if (el.tagName === 'LINK') {
            el.href = systemSettings.siteLogo;
        }
    });

    document.getElementById('site-title').textContent = systemSettings.siteTitle;
    document.getElementById('main-title').textContent = systemSettings.siteTitle;
    document.getElementById('header-title').textContent = systemSettings.siteTitle;

    if (systemSettings.backgroundColor === 'black') {
        document.body.classList.add('black-theme');
    } else {
        document.body.classList.remove('black-theme');
    }

    updateMusicPlayers();
}

function updateMusicPlayers() {
    const loginMusic = document.getElementById('login-music');
    const chatMusic = document.getElementById('chat-music');

    if (systemSettings.loginMusic) {
        loginMusic.src = systemSettings.loginMusic;
        loginMusic.volume = systemSettings.loginMusicVolume || 0.5;
    }

    if (systemSettings.chatMusic) {
        chatMusic.src = systemSettings.chatMusic;
        chatMusic.volume = systemSettings.chatMusicVolume || 0.5;
    }
}

function playLoginMusic() {
    const audio = document.getElementById('login-music');
    if (audio.src) {
        audio.play().catch(() => {});
    }
}

function stopLoginMusic() {
    const audio = document.getElementById('login-music');
    audio.pause();
    audio.currentTime = 0;
}

function playChatMusic() {
    const audio = document.getElementById('chat-music');
    if (audio.src) {
        audio.play().catch(() => {});
    }
}

// ═══════════════════════════════════════════════════════════════
// PARTY MODE
// ═══════════════════════════════════════════════════════════════

window.togglePartyMode = function() {
    const enabled = !document.body.classList.contains('party-mode');
    socket.emit('toggle-party-mode', {
        roomId: currentRoom,
        enabled: enabled
    });
};

function togglePartyEffects(enabled) {
    if (enabled) {
        document.body.classList.add('party-mode');
        createPartyLights();
    } else {
        document.body.classList.remove('party-mode');
        removePartyLights();
    }
}

function createPartyLights() {
    let container = document.getElementById('party-lights');
    if (container) return;

    container = document.createElement('div');
    container.id = 'party-lights';
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
    `;

    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
    
    for (let i = 0; i < 20; i++) {
        const light = document.createElement('div');
        light.style.cssText = `
            position: absolute;
            width: ${Math.random() * 100 + 50}px;
            height: ${Math.random() * 100 + 50}px;
            background: radial-gradient(circle, ${colors[Math.floor(Math.random() * colors.length)]} 0%, transparent 70%);
            border-radius: 50%;
            top: ${Math.random() * 100}%;
            left: ${Math.random() * 100}%;
            animation: partyFloat ${Math.random() * 3 + 2}s infinite ease-in-out;
            opacity: 0.6;
        `;
        container.appendChild(light);
    }

    document.body.appendChild(container);
}

function removePartyLights() {
    const container = document.getElementById('party-lights');
    if (container) container.remove();
}

// ═══════════════════════════════════════════════════════════════
// YOUTUBE
// ═══════════════════════════════════════════════════════════════

window.showYouTubeModal = function() {
    document.getElementById('youtube-modal').classList.add('active');
};

window.startYouTubeWatch = function() {
    const input = document.getElementById('youtube-url-input').value.trim();
    if (!input) {
        showAlert('Please enter YouTube URL or ID', 'error');
        return;
    }

    let videoId = input;
    if (input.includes('youtube.com') || input.includes('youtu.be')) {
        const match = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
        if (match) videoId = match[1];
    }

    socket.emit('start-youtube-watch', { videoId: videoId });
    hideModal('youtube-modal');
    document.getElementById('youtube-url-input').value = '';
};

function showYouTubePlayer(videoId) {
    const container = document.getElementById('youtube-player-container');
    container.style.display = 'block';

    if (!ytPlayer) {
        ytPlayer = new YT.Player('youtube-player', {
            height: '360',
            width: '640',
            videoId: videoId,
            events: {
                'onReady': (event) => event.target.playVideo()
            }
        });
    } else {
        ytPlayer.loadVideoById(videoId);
    }
}

function hideYouTubePlayer() {
    const container = document.getElementById('youtube-player-container');
    container.style.display = 'none';
    if (ytPlayer) {
        ytPlayer.stopVideo();
    }
}

window.closeYouTube = function() {
    if (currentUser?.isOwner) {
        socket.emit('stop-youtube-watch');
    }
    hideYouTubePlayer();
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

window.hideModal = function(modalId) {
    document.getElementById(modalId).classList.remove('active');
};

function clearMessages() {
    const container = document.getElementById('messages');
    if (container) {
        container.innerHTML = `
            <div class="welcome-message glass-card">
                <img src="${systemSettings.siteLogo}" alt="Welcome" class="welcome-logo">
                <h3>Welcome to ${systemSettings.siteTitle}! ❄️</h3>
                <p>Start chatting with others</p>
            </div>
        `;
    }
}

function scrollToBottom() {
    const container = document.getElementById('messages');
    if (container) {
        setTimeout(() => {
            container.scrollTop = container.scrollHeight;
        }, 100);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showAlert(message, type = 'info') {
    const colors = {
        error: '#dc2626',
        success: '#10b981',
        warning: '#f59e0b',
        info: '#4a90e2'
    };
    
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';
    alertDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type]};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        z-index: 10000;
        font-weight: 600;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => alertDiv.remove(), 300);
    }, 4000);
}

function showNotification(message) {
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: rgba(74, 144, 226, 0.9);
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        z-index: 9999;
        animation: slideIn 0.3s ease-out;
    `;
    div.textContent = message;
    document.body.appendChild(div);
    
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function showLoading(message = 'Loading...') {
    let div = document.getElementById('loading-overlay');
    
    if (!div) {
        div = document.createElement('div');
        div.id = 'loading-overlay';
        div.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            backdrop-filter: blur(10px);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
        `;
        document.body.appendChild(div);
    }
    
    div.innerHTML = `
        <div style="text-align: center;">
            <div class="spinner"></div>
            <div style="margin-top: 1.5rem; font-size: 1.2rem; font-weight: 600;">${message}</div>
        </div>
    `;
}

function hideLoading() {
    const div = document.getElementById('loading-overlay');
    if (div) div.remove();
}

function showConfirm(message, callback) {
    confirmCallback = callback;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').classList.add('active');
}

window.confirmAction = function(confirmed) {
    hideModal('confirm-modal');
    if (confirmCallback) {
        confirmCallback(confirmed);
        confirmCallback = null;
    }
};

function startHeartbeat() {
    setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('ping');
        }
    }, 30000);
}

// ═══════════════════════════════════════════════════════════════
// VISUAL EFFECTS
// ═══════════════════════════════════════════════════════════════

function createSnowfall() {
    const container = document.getElementById('snowflakes');
    if (!container) return;
    
    container.innerHTML = '';
    
    for (let i = 0; i < 50; i++) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = '❄';
        snowflake.style.cssText = `
            left: ${Math.random() * 100}%;
            animation-duration: ${Math.random() * 3 + 2}s;
            animation-delay: ${Math.random() * 5}s;
            font-size: ${Math.random() * 10 + 10}px;
        `;
        container.appendChild(snowflake);
    }
}

function drawSnowman() {
    const canvas = document.getElementById('snowman-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = 200;
    canvas.height = 250;

    ctx.globalAlpha = 0.15; // Reduced opacity

    ctx.fillStyle = 'white';
    
    ctx.beginPath();
    ctx.arc(100, 180, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a90e2';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(100, 110, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(100, 50, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'black';
    ctx.beginPath();
    ctx.arc(90, 45, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(110, 45, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'orange';
    ctx.beginPath();
    ctx.moveTo(100, 50);
    ctx.lineTo(120, 50);
    ctx.lineTo(100, 55);
    ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(100, 60, 10, 0, Math.PI);
    ctx.stroke();

    ctx.fillStyle = 'black';
    [100, 115, 130].forEach(y => {
        ctx.beginPath();
        ctx.arc(100, y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    let y = 0;
    let direction = 1;
    setInterval(() => {
        y += direction * 0.5;
        if (y > 10 || y < -10) direction *= -1;
        canvas.style.transform = `translateX(-50%) translateY(${y}px)`;
    }, 50);
}

// CSS Animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
    @keyframes partyFloat {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-50px) scale(1.2); }
    }
    .my-message {
        align-self: flex-end;
        background: rgba(74, 144, 226, 0.2);
        border-left: 4px solid #4a90e2;
    }
    .private-user-item {
        padding: 1rem;
        cursor: pointer;
        border-radius: 10px;
        transition: all 0.3s ease;
        margin-bottom: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border: 2px solid transparent;
    }
    .private-user-item:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: var(--ice-blue);
        transform: translateX(5px);
    }
    .private-header {
        padding: 1rem;
        font-weight: 700;
        border-bottom: 2px solid var(--glass-border);
        margin-bottom: 1rem;
        color: var(--light-blue);
    }
    .spinner {
        width: 60px;
        height: 60px;
        border: 5px solid rgba(255, 255, 255, 0.3);
        border-top: 5px solid var(--ice-blue);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .tool-btn {
        padding: 0.6rem 1rem;
        background: rgba(255, 255, 255, 0.1);
        border: 2px solid var(--glass-border);
        border-radius: 10px;
        font-size: 1.2rem;
        cursor: pointer;
        transition: all 0.3s ease;
        color: white;
    }
    .tool-btn:hover {
        background: var(--ice-blue);
        transform: translateY(-2px);
        box-shadow: 0 5px 15px rgba(74, 144, 226, 0.4);
    }
    .tools-buttons {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.8rem;
        flex-wrap: wrap;
    }
    .owner-actions {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
        flex-wrap: wrap;
    }
`;
document.head.appendChild(style);

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
    console.log('❄️ Cold Room V2 Ready');
    initializeSocket();
    createSnowfall();
    drawSnowman();
    
    setTimeout(() => {
        playLoginMusic();
    }, 1000);
});

window.onYouTubeIframeAPIReady = function() {
    console.log('✅ YouTube API Ready');
};

console.log('✅ Script V2 loaded successfully');

// ═══════════════════════════════════════════════════════════════
// END OF SCRIPT - Cold Room V2 Final
// © 2025 Cold Room - All Rights Reserved
// ═══════════════════════════════════════════════════════════════
