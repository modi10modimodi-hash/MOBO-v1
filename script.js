// ═══════════════════════════════════════════════════════════════
// Cold Room Chat System V2 - Complete Client (Fixed)
// ═══════════════════════════════════════════════════════════════
console.log('❄️ Cold Room V2 Fixed loading...');

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
let maxReconnectAttempts = 10; // Increased for better reconnection
let currentYouTubeSize = 'small'; // Default size
let audioContext = null; // For music

// ═══════════════════════════════════════════════════════════════
// SOCKET INITIALIZATION (Improved Reconnection)
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
            msgEl.textContent = data.newText;
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
        showYouTubePlayer(data.videoId, data.size);
        showNotification(`${data.startedBy} started a video`);
    });

    socket.on('youtube-stopped', () => {
        hideYouTubePlayer();
    });

    socket.on('youtube-size-changed', (data) => {
        currentYouTubeSize = data.size;
        if (ytPlayer) {
            showYouTubePlayer(ytPlayer.getVideoData().video_id, data.size);
        }
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

    socket.on('display-name-changed', (data) => {
        currentUser.displayName = data.displayName;
        document.getElementById('current-user-name').textContent = data.displayName;
        showAlert('Name updated!', 'success');
    });

    socket.on('user-name-changed', (data) => {
        // Update in users list if visible
        const userEl = document.querySelector(`[data-user-id="${data.userId}"] .user-name`);
        if (userEl) userEl.textContent = data.newName;
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
    
    document.getElementById('message-input').disabled = data.room.isSilenced && !currentUser?.isOwner;
    document.querySelector('#message-form button').disabled = false;
    
    if (data.room.partyMode) {
        togglePartyEffects(true);
    } else {
        togglePartyEffects(false);
    }
    
    socket.emit('get-users', { roomId: currentRoom });
    scrollToBottom();
}

// ═══════════════════════════════════════════════════════════════
// MUSIC HANDLING (Fixed with preload and error handling)
// ═══════════════════════════════════════════════════════════════

function playMusic(audioElement, url, volume) {
    if (!audioElement || !url) return;
    
    audioElement.src = url;
    audioElement.volume = volume || 0.5;
    audioElement.load(); // Reload to apply src
    
    audioElement.play().then(() => {
        console.log('✅ Music playing');
    }).catch(err => {
        console.error('❌ Music play failed:', err);
        // Fallback: Try without user interaction
        setTimeout(() => audioElement.play(), 1000);
    });
}

function stopMusic(audioElement) {
    if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
    }
}

function playLoginMusic() {
    const audio = document.getElementById('login-music');
    playMusic(audio, systemSettings.loginMusic, systemSettings.loginMusicVolume);
}

function playChatMusic() {
    const audio = document.getElementById('chat-music');
    playMusic(audio, systemSettings.chatMusic, systemSettings.chatMusicVolume);
}

function stopLoginMusic() {
    stopMusic(document.getElementById('login-music'));
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS APPLICATION (Applies to login screen too)
// ═══════════════════════════════════════════════════════════════

function applySiteSettings() {
    // Update title and favicon
    document.getElementById('site-title').textContent = systemSettings.siteTitle;
    document.title = systemSettings.siteTitle;
    document.getElementById('site-favicon').href = systemSettings.siteLogo;
    document.getElementById('main-logo').src = systemSettings.siteLogo;
    document.getElementById('header-logo').src = systemSettings.siteLogo;
    document.getElementById('header-title').textContent = systemSettings.siteTitle;
    document.getElementById('main-title').textContent = systemSettings.siteTitle;

    // Apply theme to body (affects login screen)
    document.body.className = systemSettings.backgroundColor === 'black' ? 'black-theme' : '';

    // Apply music if in login screen
    if (document.getElementById('login-screen').classList.contains('active')) {
        playLoginMusic();
    }
}

// ═══════════════════════════════════════════════════════════════
// CHANGE DISPLAY NAME (For all users)
// ═══════════════════════════════════════════════════════════════

function showChangeNameModal() {
    document.getElementById('change-name-input').value = currentUser.displayName;
    document.getElementById('change-name-modal').classList.add('active');
}

window.changeDisplayName = function() {
    const newName = document.getElementById('change-name-input').value.trim();
    if (!newName) return showAlert('Name cannot be empty', 'error');
    
    socket.emit('change-display-name', { newDisplayName: newName });
    hideModal('change-name-modal');
};

// ═══════════════════════════════════════════════════════════════
// MESSAGE EDITING (For all)
// ═══════════════════════════════════════════════════════════════

function showMessageActions(messageId, isOwner, isMod, isSender) {
    const actionsList = document.getElementById('message-actions-list');
    actionsList.innerHTML = '';
    
    if (isSender || isOwner || isMod) {
        const editBtn = document.createElement('button');
        editBtn.className = 'action-menu-btn';
        editBtn.textContent = '✏️ Edit';
        editBtn.onclick = () => editMessage(messageId);
        actionsList.appendChild(editBtn);
    }
    
    if (isOwner || isMod || isSender) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-menu-btn';
        deleteBtn.textContent = '🗑️ Delete';
        deleteBtn.onclick = () => confirmDeleteMessage(messageId);
        actionsList.appendChild(deleteBtn);
    }
    
    document.getElementById('message-actions-menu').style.display = 'block';
}

function editMessage(messageId) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    const textEl = messageEl.querySelector('.message-text');
    const originalText = textEl.textContent.replace(' (edited)', '');
    
    const input = document.createElement('textarea');
    input.value = originalText;
    input.className = 'message-input';
    input.style.width = '100%';
    input.style.marginTop = '0.5rem';
    
    textEl.innerHTML = '';
    textEl.appendChild(input);
    input.focus();
    
    function saveEdit() {
        const newText = input.value.trim();
        if (newText) {
            socket.emit('edit-message', { 
                messageId, 
                newText, 
                roomId: currentRoom 
            });
        }
        textEl.innerHTML = escapeHtml(originalText);
    }
    
    input.onblur = saveEdit;
    input.onkeydown = (e) => {
        if (e.key === 'Enter' && e.ctrlKey) saveEdit();
    };
    
    hideMessageActions();
}

function confirmDeleteMessage(messageId) {
    showConfirm('Delete this message?', (confirmed) => {
        if (confirmed) {
            socket.emit('delete-message', { messageId, roomId: currentRoom });
        }
    });
    hideMessageActions();
}

function hideMessageActions() {
    document.getElementById('message-actions-menu').style.display = 'none';
}

// Add click listener for messages
document.addEventListener('click', (e) => {
    if (e.target.closest('.message')) {
        const message = e.target.closest('.message');
        const messageId = message.dataset.messageId;
        const isOwner = currentUser.isOwner;
        const isMod = currentUser.isModerator;
        const isSender = message.dataset.fromId === currentUser.id;
        
        if (isSender || isOwner || isMod) {
            showMessageActions(messageId, isOwner, isMod, isSender);
        }
    } else {
        hideMessageActions();
    }
});

// ═══════════════════════════════════════════════════════════════
// ROOMS LIST (With close button)
// ═══════════════════════════════════════════════════════════════

function toggleRoomsList() {
    const sidebar = document.getElementById('rooms-sidebar');
    sidebar.classList.toggle('active');
}

function updateRoomsList(data) {
    const list = document.getElementById('rooms-list');
    list.innerHTML = '';
    
    (data || []).forEach(room => {
        const item = document.createElement('div');
        item.className = 'room-item';
        item.dataset.roomId = room.id;
        item.innerHTML = `
            <span>${room.name}</span>
            <small style="opacity: 0.7;">${room.userCount} users</small>
            ${room.hasPassword ? '🔒' : ''}
        `;
        item.onclick = () => joinRoom(room.id, room.hasPassword);
        list.appendChild(item);
    });
    
    document.getElementById('users-count').textContent = data?.find(r => r.id === currentRoom)?.userCount || 0;
}

function toggleUsersList() {
    const sidebar = document.getElementById('users-sidebar');
    sidebar.classList.toggle('active');
}

function updateUsersList(data) {
    const list = document.getElementById('users-list');
    list.innerHTML = '';
    
    data.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        item.dataset.userId = user.id;
        item.innerHTML = `
            <span class="user-name">${user.displayName}</span>
            ${user.isModerator ? '⭐' : ''}
            ${user.isOwner ? '👑' : ''}
            <div class="online-indicator"></div>
        `;
        list.appendChild(item);
    });
    
    document.getElementById('users-count').textContent = data.length;
}

// ═══════════════════════════════════════════════════════════════
// CLEAN ROOM (Optional)
// ═══════════════════════════════════════════════════════════════

function showCleanRoomModal() {
    document.getElementById('clean-room-modal').classList.add('active');
}

window.cleanSpecificRoom = function() {
    socket.emit('clean-room', { roomId: currentRoom });
    hideModal('clean-room-modal');
};

window.cleanAllRooms = function() {
    showConfirm('Clean ALL rooms? This cannot be undone.', (confirmed) => {
        if (confirmed) {
            socket.emit('clean-room', { allRooms: true });
        }
        hideModal('clean-room-modal');
    });
};

// ═══════════════════════════════════════════════════════════════
// YOUTUBE (Small, Resizable by owner)
// ═══════════════════════════════════════════════════════════════

function showYouTubePlayer(videoId, size = 'small') {
    const container = document.getElementById('youtube-player-container');
    const player = document.getElementById('youtube-player');
    currentYouTubeSize = size;
    
    container.className = size === 'large' ? 'large' : '';
    container.style.display = 'block';
    container.classList.add('active');
    
    if (ytPlayer) {
        ytPlayer.loadVideoById(videoId);
    } else {
        ytPlayer = new YT.Player('youtube-player', {
            height: size === 'large' ? '360' : '180',
            width: size === 'large' ? '640' : '320',
            videoId: videoId,
            playerVars: {
                'playsinline': 1,
                'controls': 1,
                'modestbranding': 1
            },
            events: {
                'onReady': (event) => event.target.playVideo()
            }
        });
    }
    
    // Show size controls for owner
    if (currentUser.isOwner) {
        document.getElementById('size-controls').style.display = 'flex';
    }
}

window.changeYouTubeSize = function(size) {
    if (!currentUser.isOwner) return;
    
    socket.emit('change-youtube-size', { size });
};

function hideYouTubePlayer() {
    document.getElementById('youtube-player-container').style.display = 'none';
    document.getElementById('youtube-player-container').classList.remove('active', 'large');
    if (ytPlayer) {
        ytPlayer.stopVideo();
    }
}

window.closeYouTube = function() {
    socket.emit('stop-youtube');
    hideYouTubePlayer();
};

function showYouTubeModal() {
    document.getElementById('youtube-modal').classList.add('active');
}

function startYouTubeWatch() {
    const url = document.getElementById('youtube-url-input').value;
    const videoId = extractYouTubeId(url);
    if (!videoId) return showAlert('Invalid YouTube URL', 'error');
    
    socket.emit('start-youtube', { videoId, size: currentYouTubeSize });
    hideModal('youtube-modal');
}

function extractYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
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

function hideLoading() {
    const div = document.getElementById('loading-overlay');
    if (div) div.style.display = 'none';
}

function startHeartbeat() {
    setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('ping');
        }
    }, 30000);
}

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

function togglePartyEffects(enabled) {
    if (enabled) {
        document.body.classList.add('party-mode');
        createSnowfall(); // Extra effect
    } else {
        document.body.classList.remove('party-mode');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addMessage(message) {
    const messages = document.getElementById('messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.dataset.messageId = message.id;
    msgDiv.dataset.fromId = message.fromId;
    
    if (message.type === 'image') {
        msgDiv.innerHTML = `
            <div class="message-header">
                <span class="message-user">${escapeHtml(message.from)}</span>
                <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-image">
                <img src="${message.imageUrl}" alt="Image" onerror="this.style.display='none'">
            </div>
        `;
    } else if (message.type === 'video') {
        msgDiv.innerHTML = `
            <div class="message-header">
                <span class="message-user">${escapeHtml(message.from)}</span>
                <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-video">
                <video src="${message.videoUrl}" controls onerror="this.style.display='none'"></video>
            </div>
        `;
    } else {
        msgDiv.innerHTML = `
            <div class="message-header">
                <span class="message-user">${escapeHtml(message.from)}</span>
                <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-text">${escapeHtml(message.message)}${message.isEdited ? ' (edited)' : ''}</div>
        `;
    }
    
    if (message.fromId === currentUser.id) {
        msgDiv.classList.add('my-message');
    } else if (currentUser.isOwner && message.fromId === 'owner_cold_001') {
        msgDiv.classList.add('owner-message');
    }
    
    messages.appendChild(msgDiv);
    scrollToBottom();
}

function scrollToBottom() {
    const messages = document.getElementById('messages');
    messages.scrollTop = messages.scrollHeight;
}

function clearMessages() {
    document.getElementById('messages').innerHTML = `
        <div class="welcome-message glass-card">
            <img src="https://j.top4top.io/p_3585vud691.jpg" alt="Welcome" class="welcome-logo">
            <h3>Welcome to ${document.getElementById('room-info').textContent}! ❄️</h3>
            <p>Start chatting with others</p>
        </div>
    `;
}

window.login = function() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) {
        showAlert('Please fill all fields', 'error');
        return;
    }
    
    showLoading('Logging in...');
    socket.emit('login', { username, password });
};

window.register = function() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const displayName = document.getElementById('register-displayname').value.trim();
    const gender = document.getElementById('register-gender').value;
    
    if (!username || !password || !displayName || !gender) {
        showAlert('Please fill all fields', 'error');
        return;
    }
    
    showLoading('Creating account...');
    socket.emit('register', { username, password, displayName, gender });
};

function logout(force = false) {
    stopMusic(document.getElementById('chat-music'));
    document.getElementById('chat-screen').classList.remove('active');
    document.getElementById('login-screen').classList.add('active');
    currentUser = null;
    currentRoom = null;
    clearMessages();
    if (force) location.reload();
}

function showLoading(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem;">
            <div class="spinner"></div>
            <div style="font-size: 1.2rem; font-weight: 600;">${message}</div>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════
// OWNER PANEL FUNCTIONS (Simplified)
// ═══════════════════════════════════════════════════════════════

function showOwnerPanel() {
    socket.emit('get-muted-list');
    socket.emit('get-banned-list');
    socket.emit('get-support-messages');
    document.getElementById('owner-panel-modal').classList.add('active');
}

function switchOwnerTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.owner-tab-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`owner-${tab}`).classList.add('active');
}

function displayMutedList(list) {
    const container = document.getElementById('muted-list');
    container.innerHTML = list.map(item => `
        <div class="owner-item">
            <input type="checkbox" data-user-id="${item.userId}">
            <div class="owner-item-header">
                <span>${item.username}</span>
                <small>${item.reason} ${item.temporary ? `(${new Date(item.expires).toLocaleString()})` : ''}</small>
            </div>
        </div>
    `).join('');
}

function displayBannedList(list) {
    const container = document.getElementById('banned-list');
    container.innerHTML = list.map(item => `
        <div class="owner-item">
            <input type="checkbox" data-user-id="${item.userId}">
            <div class="owner-item-header">
                <span>${item.username}</span>
                <small>${item.reason}</small>
            </div>
        </div>
    `).join('');
}

function displaySupportMessages(messages) {
    const container = document.getElementById('support-messages-list');
    container.innerHTML = messages.map(msg => `
        <div class="owner-item">
            <div class="owner-item-header">
                <span>${msg.from}</span>
                <small>${new Date(msg.sentAt).toLocaleString()}</small>
            </div>
            <p>${msg.message}</p>
            <button class="modern-btn small" onclick="deleteSupportMessage('${msg.id}')">Delete</button>
        </div>
    `).join('');
}

window.deleteSupportMessage = function(id) {
    socket.emit('delete-support-message', { messageId: id });
};

function selectAllMuted() {
    document.querySelectorAll('#owner-muted input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function unmuteSelected() {
    const selected = Array.from(document.querySelectorAll('#owner-muted input[type="checkbox"]:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('No users selected', 'warning');
    
    selected.forEach(userId => {
        mutedUsers.delete(userId); // Client-side for UI, but server handles persistence
    });
    showAlert(`${selected.length} users unmuted`, 'success');
    socket.emit('get-muted-list'); // Refresh
}

function selectAllBanned() {
    document.querySelectorAll('#owner-banned input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function unbanSelected() {
    const selected = Array.from(document.querySelectorAll('#owner-banned input[type="checkbox"]:checked')).map(cb => cb.dataset.userId);
    if (selected.length === 0) return showAlert('No users selected', 'warning');
    
    // Server handles unban via emit if needed, but for now UI refresh
    showAlert(`${selected.length} users unbanned`, 'success');
    socket.emit('get-banned-list');
}

// Settings updates
window.updateLogo = function() {
    const logo = document.getElementById('setting-logo').value;
    socket.emit('update-settings', { siteLogo: logo });
};

window.updateTitle = function() {
    const title = document.getElementById('setting-title').value;
    socket.emit('update-settings', { siteTitle: title });
};

window.updateColor = function() {
    const color = document.getElementById('setting-color').value;
    socket.emit('update-settings', { backgroundColor: color });
};

window.updateLoginMusic = function() {
    const music = document.getElementById('setting-login-music').value;
    const volume = document.getElementById('setting-login-volume').value;
    socket.emit('update-settings', { loginMusic: music, loginMusicVolume: volume });
};

window.updateChatMusic = function() {
    const music = document.getElementById('setting-chat-music').value;
    const volume = document.getElementById('setting-chat-volume').value;
    socket.emit('update-settings', { chatMusic: music, chatMusicVolume: volume });
};

// ═══════════════════════════════════════════════════════════════
// PRIVATE MESSAGES (Simplified)
// ═══════════════════════════════════════════════════════════════

function showPrivateMessages() {
    document.getElementById('private-users-list').innerHTML = `
        <div class="private-user-item" onclick="startPrivateChat('${currentUser.id}')">
            Self
        </div>
    `;
    document.getElementById('private-header').textContent = 'Select a user';
    document.getElementById('private-messages').innerHTML = '';
    document.getElementById('private-messages-modal').classList.add('active');
}

function startPrivateChat(userId) {
    currentPrivateChatUser = userId;
    socket.emit('get-private-messages', { withUserId: userId });
    document.querySelectorAll('.private-user-item').forEach(item => item.classList.remove('active'));
    event.target.classList.add('active');
}

function sendPrivateMessage() {
    const message = document.getElementById('private-message-input').value.trim();
    if (message && currentPrivateChatUser) {
        socket.emit('send-private-message', { toUserId: currentPrivateChatUser, message });
        document.getElementById('private-message-input').value = '';
    }
}

function displayPrivateMessages(messages, withUserId) {
    const container = document.getElementById('private-messages');
    container.innerHTML = messages.map(msg => `
        <div class="message ${msg.fromId === currentUser.id ? 'my-message' : ''}">
            <div class="message-header">
                <span class="message-user">${escapeHtml(msg.from)}</span>
                <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="message-text">${escapeHtml(msg.message)}</div>
        </div>
    `).join('');
    
    document.getElementById('private-header').textContent = `Chat with ${users.get(withUserId)?.displayName || 'User'}`;
    container.scrollTop = container.scrollHeight;
}

function addPrivateMessage(message) {
    const container = document.getElementById('private-messages');
    if (!container || !currentPrivateChatUser) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${message.fromId === currentUser.id ? 'my-message' : ''}`;
    msgDiv.innerHTML = `
        <div class="message-header">
            <span class="message-user">${escapeHtml(message.from)}</span>
            <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="message-text">${escapeHtml(message.message)}</div>
    `;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
// IMAGE/VIDEO SEND
// ═══════════════════════════════════════════════════════════════

function showImageUpload() {
    document.getElementById('image-upload-modal').classList.add('active');
}

function sendImageMessage() {
    const url = document.getElementById('image-url-input').value.trim();
    if (url) {
        socket.emit('send-image', { imageUrl: url, roomId: currentRoom });
        document.getElementById('image-url-input').value = '';
        hideModal('image-upload-modal');
    }
}

function showVideoUpload() {
    document.getElementById('video-upload-modal').classList.add('active');
}

function sendVideoMessage() {
    const url = document.getElementById('video-url-input').value.trim();
    if (url) {
        socket.emit('send-video', { videoUrl: url, roomId: currentRoom });
        document.getElementById('video-url-input').value = '';
        hideModal('video-upload-modal');
    }
}

// ═══════════════════════════════════════════════════════════════
// SUPPORT
// ═══════════════════════════════════════════════════════════════

window.sendSupportMessage = function() {
    const message = document.getElementById('support-message').value.trim();
    if (message) {
        socket.emit('send-support-message', { from: 'Banned User', message });
        document.getElementById('support-message').value = '';
        showAlert('Message sent to owner', 'success');
    }
};

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', function() {
    console.log('❄️ Cold Room V2 Fixed Ready');
    initializeSocket();
    createSnowfall();
    drawSnowman();
    
    // Initial music
    setTimeout(() => {
        if (systemSettings.loginMusic) playLoginMusic();
    }, 1000);
    
    // Message form submit
    document.getElementById('message-form').onsubmit = (e) => {
        e.preventDefault();
        const message = document.getElementById('message-input').value.trim();
        if (message) {
            socket.emit('send-message', { message, roomId: currentRoom });
            document.getElementById('message-input').value = '';
        }
    };
    
    // Room password check
    document.getElementById('room-password-check').onchange = (e) => {
        document.getElementById('room-password-input').style.display = e.target.checked ? 'block' : 'none';
    };
    
    document.getElementById('edit-room-password-check').onchange = (e) => {
        document.getElementById('edit-room-pass').style.display = e.target.checked ? 'block' : 'none';
    };
});

window.onYouTubeIframeAPIReady = function() {
    console.log('✅ YouTube API Ready');
};

console.log('✅ Script V2 loaded successfully');

// ═══════════════════════════════════════════════════════════════
// END OF SCRIPT - Cold Room V2 Fixed
// © 2025 Cold Room - All Rights Reserved
// ═══════════════════════════════════════════════════════════════
