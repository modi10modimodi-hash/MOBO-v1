// ═══════════════════════════════════════════════════════════════
// Cold Room V2 - Complete Fixed Client (FINAL Synced)
// ═══════════════════════════════════════════════════════════════
console.log('❄️ Cold Room V2 Fixed loading...');

let socket, currentUser, currentRoom, systemSettings = {}, selectedUserId, selectedUsername;
let currentPrivateChatUser, confirmCallback, editingRoomId, ytPlayer, currentYTSize = 'medium';
let isReconnecting = false;
let globalYoutubeState = null; // { videoId, startedAt, size }

// ───────────────────────────────────────────────────────────────
// Fetch settings early (for login page theme/music)
// ───────────────────────────────────────────────────────────────
async function fetchInitialSettings() {
    try {
        const res = await fetch('/settings');
        if (!res.ok) return;
        const s = await res.json();
        systemSettings = s;
        applySiteSettings();
        // preload login music src and wait for user click to play
        updateMusicPlayers();
    } catch (e) {
        console.log('Settings fetch skipped');
    }
}

// ═══════════════════════════════════════════════════════════════
// SOCKET INITIALIZATION
// ═══════════════════════════════════════════════════════════════
function initializeSocket() {
    socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
        timeout: 20000
    });
    setupSocketListeners();
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('✅ Connected');
        isReconnecting = false;
        hideLoading();
        if (currentUser && currentRoom) {
            socket.emit('join-room', { roomId: currentRoom });
            showNotification('✅ Reconnected');
        }
    });

    socket.on('disconnect', () => {
        if (!isReconnecting) {
            showNotification('⚠️ Reconnecting...');
            isReconnecting = true;
        }
    });

    socket.on('reconnect', () => {
        isReconnecting = false;
        if (currentUser && currentRoom) socket.emit('join-room', { roomId: currentRoom });
    });

    socket.on('login-success', handleLoginSuccess);
    socket.on('login-error', (msg) => { hideLoading(); showAlert(msg, 'error'); });
    socket.on('banned-user', (data) => {
        hideLoading();
        showAlert(`Banned: ${data.reason}`, 'error');
        document.getElementById('support-section').style.display = 'block';
    });
    socket.on('register-success', (data) => {
        hideLoading();
        showAlert(data.message, 'success');
        document.getElementById('login-username').value = data.username;
    });
    socket.on('register-error', (msg) => { hideLoading(); showAlert(msg, 'error'); });

    socket.on('new-message', (msg) => {
        if (msg.roomId === currentRoom) { addMessage(msg); scrollToBottom(); }
    });
    socket.on('message-edited', (data) => {
        const el = document.querySelector(`[data-message-id="${data.messageId}"] .message-text`);
        if (el) el.innerHTML = esc(data.newText) + ' <small>(edited)</small>';
    });

    socket.on('new-private-message', (msg) => {
        if (currentPrivateChatUser === msg.from) addPrivateMessage(msg);
        showNotification(`New from ${msg.fromName}`);
    });
    socket.on('private-message-sent', addPrivateMessage);
    socket.on('private-messages-list', (d) => displayPrivateMessages(d.messages, d.withUserId));

    socket.on('room-joined', handleRoomJoined);
    socket.on('room-created', (d) => {
        showAlert('Room created', 'success');
        socket.emit('join-room', { roomId: d.roomId });
        hideModal('create-room-modal');
    });
    socket.on('room-updated', (d) => {
        document.getElementById('room-info').textContent = d.name;
        showNotification('Room updated');
    });

    socket.on('users-list', updateUsersList);
    socket.on('rooms-list', updateRoomsList);
    socket.on('user-joined', (d) => showNotification(`${d.username} joined`));

    socket.on('message-deleted', (d) => {
        const el = document.querySelector(`[data-message-id="${d.messageId}"]`);
        if (el) el.remove();
    });
    socket.on('chat-cleaned', (d) => { clearMessages(); showAlert(d.message, 'info'); });

    socket.on('room-silenced', (d) => {
        const disabled = d.forceDisable ?? true;
        document.getElementById('message-input').disabled = disabled && !currentUser?.isOwner;
        document.querySelector('#message-form button').disabled = disabled && !currentUser?.isOwner;
        showAlert(d.message, 'warning');
    });
    socket.on('room-unsilenced', (d) => {
        document.getElementById('message-input').disabled = false;
        document.querySelector('#message-form button').disabled = false;
        showAlert(d.message, 'success');
    });
    socket.on('room-deleted', (d) => {
        showAlert(d.message, 'error');
        socket.emit('join-room', { roomId: 'global_cold' });
    });
    socket.on('party-mode-changed', (d) => {
        togglePartyEffects(d.enabled);
        showNotification(d.enabled ? '🎉 Party ON!' : 'Party OFF');
    });

    // YouTube sync
    socket.on('youtube-started', (d) => {
        globalYoutubeState = d;
        showYouTubePlayer(d.videoId);
        syncYouTubeToElapsed(d);
        showNotification(`${d.startedBy} started video`);
    });
    socket.on('youtube-stopped', () => {
        globalYoutubeState = null;
        hideYouTubePlayer();
    });
    socket.on('youtube-resize', (d) => resizeYouTubePlayer(d.size));

    socket.on('action-success', (msg) => showAlert(msg, 'success'));
    socket.on('error', (msg) => showAlert(msg, 'error'));
    socket.on('message-error', (msg) => showAlert(msg, 'error'));

    socket.on('banned', (d) => {
        showAlert(`Banned: ${d.reason}`, 'error');
        setTimeout(() => logout(true), 3000);
    });
    socket.on('account-deleted', (d) => {
        showAlert(d.message, 'error');
        setTimeout(() => logout(true), 2000);
    });

    socket.on('settings-updated', (s) => {
        systemSettings = s;
        applySiteSettings();
        showAlert('Settings updated', 'info');
    });

    socket.on('support-message-sent', (d) => showAlert(d.message, 'success'));
    socket.on('support-messages-list', displaySupportMessages);
    socket.on('muted-list', displayMutedList);
    socket.on('banned-list', displayBannedList);
}

// ═══════════════════════════════════════════════════════════════
// LOGIN & REGISTER
// ═══════════════════════════════════════════════════════════════
function handleLoginSuccess(data) {
    currentUser = data.user;
    currentRoom = data.room.id;
    systemSettings = data.systemSettings;
    globalYoutubeState = data.youtube || null;

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
    data.room.messages.forEach(addMessage);

    document.getElementById('message-input').disabled = false;
    document.querySelector('#message-form button').disabled = false;

    socket.emit('get-rooms');
    socket.emit('get-users', { roomId: currentRoom });

    if (currentUser.isOwner) {
        document.getElementById('owner-panel-btn').style.display = 'inline-block';
        document.getElementById('owner-tools').style.display = 'flex';
    }

    if (data.room.partyMode) togglePartyEffects(true);

    applySiteSettings();
    startHeartbeat();
    createSnowfall();
    drawSnowman();

    // If YouTube was ongoing and we're in global room, show and sync
    if (globalYoutubeState && currentRoom === 'global_cold') {
        showYouTubePlayer(globalYoutubeState.videoId);
        syncYouTubeToElapsed(globalYoutubeState);
        resizeYouTubePlayer(globalYoutubeState.size || 'medium');
    }
}

function handleRoomJoined(data) {
    currentRoom = data.room.id;
    document.getElementById('room-info').textContent = data.room.name;
    
    clearMessages();
    data.room.messages.forEach(addMessage);
    
    document.getElementById('message-input').disabled = false;
    document.querySelector('#message-form button').disabled = false;
    
    togglePartyEffects(data.room.partyMode || false);
    socket.emit('get-users', { roomId: currentRoom });
    scrollToBottom();

    if (data.youtube && currentRoom === 'global_cold') {
        globalYoutubeState = data.youtube;
        showYouTubePlayer(globalYoutubeState.videoId);
        syncYouTubeToElapsed(globalYoutubeState);
        resizeYouTubePlayer(globalYoutubeState.size || 'medium');
    } else if (currentRoom !== 'global_cold') {
        hideYouTubePlayer();
    }
}

window.login = function() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) return showAlert('Enter username and password', 'error');
    showLoading('Logging in...');
    socket.emit('login', { username, password });
};

window.register = function() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const displayName = document.getElementById('register-displayname').value.trim();
    const gender = document.getElementById('register-gender').value;

    if (!username || !password || !displayName || !gender) {
        return showAlert('Fill all fields', 'error');
    }
    if (username.length < 3 || username.length > 20) {
        return showAlert('Username: 3-20 chars', 'error');
    }
    if (password.length < 6) {
        return showAlert('Password: 6+ chars', 'error');
    }
    if (displayName.length < 3 || displayName.length > 30) {
        return showAlert('Display name: 3-30 chars', 'error');
    }

    showLoading('Creating account...');
    socket.emit('register', { username, password, displayName, gender });
};

window.sendSupportMessage = function() {
    const message = document.getElementById('support-message').value.trim();
    if (!message) return showAlert('Write your message', 'error');
    socket.emit('send-support-message', {
        from: document.getElementById('login-username').value || 'Anonymous',
        message
    });
    document.getElementById('support-message').value = '';
};

window.logout = function(forced = false) {
    if (forced || confirm('Logout?')) {
        showLoading('Logging out...');
        if (socket) socket.disconnect();
        setTimeout(() => location.reload(), 1000);
    }
};

// ═══════════════════════════════════════════════════════════════
/* SEND MESSAGES */
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
    document.getElementById('register-password')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') register();
    });
});

function sendMessage() {
    const textarea = document.getElementById('message-input');
    const text = textarea.value.trim();
    if (!text) return;
    if (!socket || !socket.connected) return showAlert('Reconnecting...', 'warning');
    socket.emit('send-message', { text, roomId: currentRoom });
    textarea.value = '';
}

function editMessage(messageId, currentText) {
    const newText = prompt('Edit message:', currentText || '');
    if (newText && newText.trim() && newText.trim() !== currentText) {
        socket.emit('edit-message', { messageId, newText: newText.trim() });
    }
}

// ═══════════════════════════════════════════════════════════════
/* MEDIA UPLOAD */
// ═══════════════════════════════════════════════════════════════
window.showImageUpload = () => document.getElementById('image-upload-modal').classList.add('active');
window.sendImageMessage = function() {
    const url = document.getElementById('image-url-input').value.trim();
    if (!url) return showAlert('Enter image URL', 'error');
    socket.emit('send-image', { imageUrl: url });
    document.getElementById('image-url-input').value = '';
    hideModal('image-upload-modal');
};

window.showVideoUpload = () => document.getElementById('video-upload-modal').classList.add('active');
window.sendVideoMessage = function() {
    const url = document.getElementById('video-url-input').value.trim();
    if (!url) return showAlert('Enter video URL', 'error');
    if (!url.toLowerCase().endsWith('.mp4')) return showAlert('MP4 only', 'error');
    socket.emit('send-video', { videoUrl: url });
    document.getElementById('video-url-input').value = '';
    hideModal('video-upload-modal');
};

// ═══════════════════════════════════════════════════════════════
/* DISPLAY MESSAGES */
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
    if (message.isOwner) badges += '<span class="badge owner-badge">👑</span>';
    else if (message.isModerator) badges += '<span class="badge moderator-badge">⭐</span>';

    if (message.isVideo) {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div><span class="message-user">${esc(message.avatar)} ${esc(message.username)}</span>${badges}</div>
            </div>
            <div class="message-video">
                <video controls style="max-width: 500px; max-height: 400px; border-radius: 10px;">
                    <source src="${esc(message.videoUrl)}" type="video/mp4">
                </video>
            </div>
            <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
        `;
    } else if (message.isImage) {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div><span class="message-user">${esc(message.avatar)} ${esc(message.username)}</span>${badges}</div>
            </div>
            <div class="message-image">
                <img src="${esc(message.imageUrl)}" alt="Image" style="max-width: 400px; border-radius: 10px;">
            </div>
            <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-header">
                <div><span class="message-user">${esc(message.avatar)} ${esc(message.username)}</span>${badges}</div>
            </div>
            <div class="message-text">${esc(message.text)}${message.edited ? ' <small>(edited)</small>' : ''}</div>
            <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
        `;
    }

    messageDiv.style.cursor = 'pointer';
    messageDiv.addEventListener('click', (e) => {
        if (!e.target.closest('.badge') && !e.target.closest('video') && !e.target.closest('img')) {
            selectedUserId = message.userId;
            selectedUsername = message.username;
            showMessageActions(message);
        }
    });

    container.appendChild(messageDiv);
    scrollToBottom();
}

function showMessageActions(message) {
    const actions = [];

    // Everyone can edit their own messages (owner too)
    if (!message.isImage && !message.isVideo && message.userId === currentUser?.id) {
        actions.push({ text: '✏️ Edit My Message', action: () => editMessage(message.id, message.text) });
    }

    // Everyone can change their own display name
    actions.push({ text: '📝 Change My Name', action: changeName });

    // Owner/mod tools
    if (currentUser?.isOwner) {
        if (message.userId !== currentUser.id) {
            actions.push({ text: '👑 Add Moderator', action: addModerator });
            actions.push({ text: '⭐ Remove Moderator', action: removeModerator });
            actions.push({ text: '🔇 Mute User', action: showMuteDialog });
            actions.push({ text: '🚫 Ban User', action: banUser });
            actions.push({ text: '🗑️ Delete Account', action: deleteAccount });
        }
        actions.push({ text: '❌ Delete Message', action: () => deleteMessage(message.id) });
    } else if (currentUser?.isModerator && message.userId !== currentUser.id) {
        actions.push({ text: '🔇 Mute User', action: showMuteDialog });
    }

    if (message.userId !== currentUser?.id) {
        actions.push({ text: '💬 Private Message', action: () => openPrivateChat(selectedUserId) });
    }

    actions.push({ text: '❌ Cancel', action: hideActionsMenu });
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
        btn.onclick = () => { hideActionsMenu(); action.action(); };
        list.appendChild(btn);
    });

    menu.style.display = 'flex';
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target) && !e.target.closest('.message')) {
                hideActionsMenu();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 100);
}

function hideActionsMenu() {
    document.getElementById('message-actions-menu').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
/* USER ACTIONS */
// ═══════════════════════════════════════════════════════════════
window.changeName = function() {
    const newName = prompt('New display name (unique across platform):', currentUser.displayName);
    if (newName && newName.trim()) {
        socket.emit('change-display-name', { newName: newName.trim() });
    }
};

window.showMuteDialog = function() {
    const duration = prompt(`Mute ${selectedUsername} for minutes? (0 = permanent):`, '10');
    if (duration === null) return;
    const reason = prompt('Reason:', 'Rule violation');
    if (!reason) return;
    socket.emit('mute-user', {
        userId: selectedUserId,
        username: selectedUsername,
        duration: parseInt(duration),
        reason,
        roomId: currentRoom
    });
};

window.banUser = function() {
    showConfirm(`Ban ${selectedUsername}?\n\nThis will ban IP and kick immediately.`, (ok) => {
        if (ok) {
            const reason = prompt('Reason:', 'Serious violation');
            if (reason) socket.emit('ban-user', { userId: selectedUserId, username: selectedUsername, reason });
        }
    });
};

window.deleteAccount = function() {
    showConfirm(`⚠️ DELETE ${selectedUsername}?\n\nThis CANNOT be undone!`, (ok) => {
        if (ok) socket.emit('delete-account', { userId: selectedUserId });
    });
};

window.addModerator = function() {
    if (!confirm(`Add ${selectedUsername} as moderator?`)) return;
    socket.emit('add-moderator', { userId: selectedUserId, username: selectedUsername, roomId: currentRoom });
};

window.removeModerator = function() {
    if (!confirm(`Remove ${selectedUsername} from moderators?`)) return;
    socket.emit('remove-moderator', { userId: selectedUserId, username: selectedUsername, roomId: currentRoom });
};

function deleteMessage(messageId) {
    socket.emit('delete-message', { messageId, roomId: currentRoom });
}

function openPrivateChat(userId) {
    currentPrivateChatUser = userId;
    socket.emit('get-private-messages', { withUserId: userId });
    document.getElementById('private-messages-modal').classList.add('active');
    const user = Array.from(document.querySelectorAll('.user-item')).find(el => el.dataset.userId === userId);
    if (user) document.getElementById('private-header').textContent = `Chat with ${user.dataset.userName}`;
}

// ═══════════════════════════════════════════════════════════════
/* PRIVATE MESSAGES */
// ═══════════════════════════════════════════════════════════════
window.showPrivateMessages = function() {
    document.getElementById('private-messages-modal').classList.add('active');
    loadPrivateUsersList();
};

function loadPrivateUsersList() {
    const container = document.getElementById('private-users-list');
    container.innerHTML = '';
    socket.emit('get-users', { roomId: currentRoom });
    socket.once('users-list', (users) => {
        users.forEach(user => {
            if (user.id === currentUser?.id) return;
            const div = document.createElement('div');
            div.className = 'private-user-item';
            div.dataset.userId = user.id;
            div.dataset.userName = user.displayName;
            div.innerHTML = `<span>${esc(user.avatar)}</span><span>${esc(user.displayName)}</span>`;
            div.onclick = () => openPrivateChat(user.id);
            container.appendChild(div);
        });
    });
}

function updateUserBadges() {
    const container = document.getElementById('user-badges');
    if (!container) return;
    let badges = '';
    if (currentUser.isOwner) badges += '<span class="badge owner-badge">👑 Owner</span>';
    container.innerHTML = badges;
}

window.sendPrivateMessage = function() {
    const input = document.getElementById('private-message-input');
    const text = input.value.trim();
    if (!text || !currentPrivateChatUser) return;
    socket.emit('send-private-message', { toUserId: currentPrivateChatUser, text });
    input.value = '';
};

function displayPrivateMessages(messages, withUserId) {
    const container = document.getElementById('private-messages');
    if (!container) return;
    container.innerHTML = '';
    messages.forEach(msg => {
        const isFromMe = msg.from === currentUser?.id;
        const div = document.createElement('div');
        div.className = `message ${isFromMe ? 'my-message' : ''}`;
        div.innerHTML = `
            <div class="message-header"><span class="message-user">${esc(msg.fromName)}</span></div>
            <div class="message-text">${esc(msg.text)}${msg.edited ? ' <small>(edited)</small>' : ''}</div>
            <div class="message-footer"><span class="message-time">${msg.timestamp}</span></div>
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
        <div class="message-header"><span class="message-user">${esc(message.fromName)}</span></div>
        <div class="message-text">${esc(message.text)}</div>
        <div class="message-footer"><span class="message-time">${message.timestamp}</span></div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
/* ROOM MANAGEMENT */
// ═══════════════════════════════════════════════════════════════
window.showCreateRoomModal = () => document.getElementById('create-room-modal').classList.add('active');

window.createRoom = function() {
    const name = document.getElementById('room-name-input').value.trim();
    const description = document.getElementById('room-desc-input').value.trim();
    const password = document.getElementById('room-pass-input').value.trim();
    if (!name) return showAlert('Enter room name', 'error');
    socket.emit('create-room', { name, description, password });
    document.getElementById('room-name-input').value = '';
    document.getElementById('room-desc-input').value = '';
    document.getElementById('room-pass-input').value = '';
};

window.joinRoom = function(roomId) {
    const room = Array.from(document.querySelectorAll('.room-item')).find(el => el.dataset.roomId === roomId);
    if (room && room.dataset.hasPassword === 'true') {
        const password = prompt('Room password:');
        if (password) socket.emit('join-room', { roomId, password });
    } else {
        socket.emit('join-room', { roomId });
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
            <div class="room-item-name">${official}${lock}${esc(room.name)}</div>
            <div class="room-item-desc">${esc(room.description)}</div>
            <div class="room-item-info">
                <span>👥 ${room.userCount}</span>
                <span>${esc(room.createdBy)}</span>
            </div>
        `;
        div.onclick = () => joinRoom(room.id);

        if (currentUser?.isOwner) {
            let pressTimer;
            div.addEventListener('mousedown', () => {
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
        { text: '🔇 Silence', action: () => socket.emit('silence-room', { roomId }) },
        { text: '🔊 Unsilence', action: () => socket.emit('unsilence-room', { roomId }) },
        { text: '🧹 Clean Chat', action: () => showConfirm('Clean messages?', ok => ok && socket.emit('clean-chat', { roomId })) }
    ];
    if (!isOfficial) {
        actions.push({ text: '🗑️ Delete Room', action: () => showConfirm(`Delete "${roomName}"?`, ok => ok && socket.emit('delete-room', { roomId })) });
    }
    actions.push({ text: '❌ Cancel', action: hideActionsMenu });
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
    socket.emit('update-room', { roomId: editingRoomId, name, description, password: password || null });
    hideModal('edit-room-modal');
    document.getElementById('edit-room-name').value = '';
    document.getElementById('edit-room-desc').value = '';
    document.getElementById('edit-room-pass').value = '';
};

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
                <div class="user-avatar">${esc(user.avatar)}</div>
                ${user.isOnline ? '<span class="online-indicator"></span>' : ''}
            </div>
            <div class="user-info">
                <div class="user-name">${esc(user.displayName)} ${badges}</div>
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

// ═══════════════════════════════════════════════════════════════
/* OWNER PANEL */
// ═══════════════════════════════════════════════════════════════
window.showOwnerPanel = function() {
    document.getElementById('owner-panel-modal').classList.add('active');
    switchOwnerTab('muted');
    loadRoomsForClean();
};

window.switchOwnerTab = function(tabName) {
    document.querySelectorAll('.owner-tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`owner-${tabName}`).classList.add('active');
    event.target.classList.add('active');

    if (tabName === 'muted') socket.emit('get-muted-list');
    else if (tabName === 'banned') socket.emit('get-banned-list');
    else if (tabName === 'support') socket.emit('get-support-messages');
    else if (tabName === 'settings') {
        loadSettings();
        loadRoomsForClean();
    }
};

function displayMutedList(list) {
    const container = document.getElementById('muted-list');
    if (!container) return;
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; opacity: 0.7;">No muted users</div>';
        return;
    }
    list.forEach(item => {
        const timeLeft = item.temporary && item.expires ? Math.ceil((item.expires - Date.now()) / 60000) + ' min' : 'Permanent';
        const div = document.createElement('div');
        div.className = 'owner-item';
        div.innerHTML = `
            <div class="owner-item-header">
                <div>
                    <input type="checkbox" class="muted-checkbox" data-user-id="${item.userId}" style="margin-right: 10px; cursor: pointer;">
                    <strong>${esc(item.username)}</strong><br>
                    <small>By: ${esc(item.mutedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unmute('${item.userId}')">Unmute</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${esc(item.reason)}</small><br>
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
                    <input type="checkbox" class="banned-checkbox" data-user-id="${item.userId}" style="margin-right: 10px; cursor: pointer;">
                    <strong>${esc(item.username)}</strong><br>
                    <small>By: ${esc(item.bannedBy)}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="unban('${item.userId}')">Unban</button>
                </div>
            </div>
            <div style="margin-top: 0.5rem;">
                <small>Reason: ${esc(item.reason)}</small><br>
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
                    <strong>${esc(msg.from)}</strong><br>
                    <small>${new Date(msg.sentAt).toLocaleString()}</small>
                </div>
                <div class="owner-item-actions">
                    <button class="modern-btn small" onclick="deleteSupportMessage('${msg.id}')">Delete</button>
                </div>
            </div>
            <div style="margin-top: 1rem; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 10px; line-height: 1.6;">
                ${esc(msg.message)}
            </div>
        `;
        container.appendChild(div);
    });
}

window.selectAllMuted = () => document.querySelectorAll('.muted-checkbox').forEach(cb => cb.checked = true);
window.selectAllBanned = () => document.querySelectorAll('.banned-checkbox').forEach(cb => cb.checked = true);

window.unmuteSelected = function() {
    const selected = Array.from(document.querySelectorAll('.muted-checkbox:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('Select users first', 'error');
    showConfirm(`Unmute ${selected.length} users?`, ok => {
        if (ok) {
            socket.emit('unmute-multiple', { userIds: selected });
            setTimeout(() => socket.emit('get-muted-list'), 500);
        }
    });
};

window.unbanSelected = function() {
    const selected = Array.from(document.querySelectorAll('.banned-checkbox:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('Select users first', 'error');
    showConfirm(`Unban ${selected.length} users?`, ok => {
        if (ok) {
            socket.emit('unban-multiple', { userIds: selected });
            setTimeout(() => socket.emit('get-banned-list'), 500);
        }
    });
};

window.unmute = function(userId) {
    socket.emit('unmute-user', { userId });
    setTimeout(() => socket.emit('get-muted-list'), 500);
};

window.unban = function(userId) {
    socket.emit('unban-user', { userId });
    setTimeout(() => socket.emit('get-banned-list'), 500);
};

window.deleteSupportMessage = function(messageId) {
    socket.emit('delete-support-message', { messageId });
    setTimeout(() => socket.emit('get-support-messages'), 500);
};

// ═══════════════════════════════════════════════════════════════
/* SETTINGS */
// ═══════════════════════════════════════════════════════════════
function loadSettings() {
    document.getElementById('setting-logo').value = systemSettings.siteLogo || '';
    document.getElementById('setting-title').value = systemSettings.siteTitle || '';
    document.getElementById('setting-color').value = systemSettings.backgroundColor || 'blue';
    document.getElementById('setting-login-music').value = systemSettings.loginMusic || '';
    document.getElementById('setting-chat-music').value = systemSettings.chatMusic || '';
    document.getElementById('setting-login-volume').value = systemSettings.loginMusicVolume || 0.5;
    document.getElementById('setting-chat-volume').value = systemSettings.chatMusicVolume || 0.5;
}

function loadRoomsForClean() {
    socket.emit('get-rooms');
    socket.once('rooms-list', (rooms) => {
        const select = document.getElementById('clean-room-select');
        if (!select) return;
        select.innerHTML = '<option value="">Select Room</option>';
        rooms.forEach(room => {
            const option = document.createElement('option');
            option.value = room.id;
            option.textContent = room.name;
            select.appendChild(option);
        });
    });
}

window.updateLogo = function() {
    const logo = document.getElementById('setting-logo').value.trim();
    if (!logo) return showAlert('Enter logo URL', 'error');
    socket.emit('update-settings', { siteLogo: logo });
};

window.updateTitle = function() {
    const title = document.getElementById('setting-title').value.trim();
    if (!title) return showAlert('Enter title', 'error');
    socket.emit('update-settings', { siteTitle: title });
};

window.updateColor = function() {
    const color = document.getElementById('setting-color').value;
    socket.emit('update-settings', { backgroundColor: color });
};

window.updateLoginMusic = function() {
    const music = document.getElementById('setting-login-music').value.trim();
    const volume = parseFloat(document.getElementById('setting-login-volume').value);
    socket.emit('update-settings', { loginMusic: music, loginMusicVolume: volume });
};

window.updateChatMusic = function() {
    const music = document.getElementById('setting-chat-music').value.trim();
    const volume = parseFloat(document.getElementById('setting-chat-volume').value);
    socket.emit('update-settings', { chatMusic: music, chatMusicVolume: volume });
};

window.cleanSelectedRoom = function() {
    const roomId = document.getElementById('clean-room-select').value;
    if (!roomId) return showAlert('Select a room', 'error');
    showConfirm('Clean messages in selected room?', ok => {
        if (ok) socket.emit('clean-chat', { roomId });
    });
};

window.cleanAllRooms = function() {
    showConfirm('⚠️ Clean ALL messages in ALL rooms?\n\nThis will remove everything permanently!', ok => {
        if (ok) socket.emit('clean-all-rooms');
    });
};

function applySiteSettings() {
    document.querySelectorAll('#main-logo, #header-logo, .welcome-logo').forEach(el => {
        if (el.tagName === 'IMG') el.src = systemSettings.siteLogo;
    });
    document.getElementById('site-favicon').href = systemSettings.siteLogo;
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
    if (audio && audio.src) audio.play().catch(() => {});
}

function stopLoginMusic() {
    const audio = document.getElementById('login-music');
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

function playChatMusic() {
    const audio = document.getElementById('chat-music');
    if (audio && audio.src) audio.play().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
/* PARTY MODE */
// ═══════════════════════════════════════════════════════════════
window.togglePartyMode = function() {
    const enabled = !document.body.classList.contains('party-mode');
    socket.emit('toggle-party-mode', { roomId: currentRoom, enabled });
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
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 1;
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
/* YOUTUBE */
// ═══════════════════════════════════════════════════════════════
window.showYouTubeModal = () => document.getElementById('youtube-modal').classList.add('active');

window.startYouTubeWatch = function() {
    const input = document.getElementById('youtube-url-input').value.trim();
    if (!input) return showAlert('Enter YouTube URL or ID', 'error');

    let videoId = input;
    if (input.includes('youtube.com') || input.includes('youtu.be')) {
        const match = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
        if (match) videoId = match[1];
    }

    socket.emit('start-youtube-watch', { videoId, size: currentYTSize });
    hideModal('youtube-modal');
    document.getElementById('youtube-url-input').value = '';
};

function showYouTubePlayer(videoId) {
    const container = document.getElementById('youtube-player-container');
    container.style.display = 'block';
    container.className = `size-${currentYTSize}`;

    if (!ytPlayer) {
        ytPlayer = new YT.Player('youtube-player', {
            height: '360',
            width: '640',
            videoId: videoId,
            playerVars: { autoplay: 1, controls: 1 },
            events: { 'onReady': (event) => event.target.playVideo() }
        });
    } else {
        ytPlayer.loadVideoById(videoId);
    }
}

function hideYouTubePlayer() {
    const container = document.getElementById('youtube-player-container');
    container.style.display = 'none';
    if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
}

window.closeYouTube = function() {
    if (currentUser?.isOwner) socket.emit('stop-youtube-watch');
    hideYouTubePlayer();
};

window.resizeYT = function(size) {
    currentYTSize = size;
    const container = document.getElementById('youtube-player-container');
    container.className = `size-${size}`;
    if (currentUser?.isOwner) {
        socket.emit('youtube-resize', { size });
    }
};

function resizeYouTubePlayer(size) {
    currentYTSize = size;
    const container = document.getElementById('youtube-player-container');
    container.className = `size-${size}`;
}

function syncYouTubeToElapsed(state) {
    try {
        if (!ytPlayer || !state?.startedAt) return;
        const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
        if (elapsed > 0 && ytPlayer.seekTo) ytPlayer.seekTo(elapsed, true);
    } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
/* HELPER FUNCTIONS */
// ═══════════════════════════════════════════════════════════════
window.hideModal = (modalId) => document.getElementById(modalId).classList.remove('active');

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
    if (container) setTimeout(() => container.scrollTop = container.scrollHeight, 100);
}

function esc(text) {
    if (text === undefined || text === null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function showAlert(message, type = 'info') {
    const colors = { error: '#dc2626', success: '#10b981', warning: '#f59e0b', info: '#4a90e2' };
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';
    alertDiv.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: ${colors[type]}; color: white;
        padding: 1rem 1.5rem; border-radius: 12px;
        z-index: 10000; font-weight: 600;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        max-width: 400px; animation: slideIn 0.3s ease-out;
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
        position: fixed; top: 80px; right: 20px;
        background: rgba(74, 144, 226, 0.9); color: white;
        padding: 1rem 1.5rem; border-radius: 12px;
        z-index: 9999; animation: slideIn 0.3s ease-out;
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
        document.body.appendChild(div);
    }
    div.innerHTML = `
        <div>
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
        if (socket && socket.connected) socket.emit('ping');
    }, 30000);
}

// ═══════════════════════════════════════════════════════════════
/* VISUAL EFFECTS */
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
    ctx.globalAlpha = 0.15;

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

    let y = 0, direction = 1;
    setInterval(() => {
        y += direction * 0.5;
        if (y > 10 || y < -10) direction *= -1;
        canvas.style.transform = `translateX(-50%) translateY(${y}px)`;
    }, 50);
}

// ═══════════════════════════════════════════════════════════════
/* INITIALIZATION */
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async function() {
    console.log('❄️ Cold Room V2 Ready');
    await fetchInitialSettings();
    initializeSocket();
    createSnowfall();
    drawSnowman();
});

window.onYouTubeIframeAPIReady = () => console.log('✅ YouTube API Ready');

console.log('✅ Script V2 Final Fixed loaded');

// ═══════════════════════════════════════════════════════════════
// END - Cold Room V2 Final Fixed Synced
// © 2025 Cold Room - All Rights Reserved
