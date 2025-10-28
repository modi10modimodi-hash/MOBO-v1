const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.use(express.json({ limit: '100mb' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ═══════════════════════════════════════════════════════════════
// PERSISTENT DATA STORAGE
// ═══════════════════════════════════════════════════════════════

const DATA_FILE = 'cold_room_data.json';

let data = {
  users: {},
  rooms: {},
  mutedUsers: {},
  bannedUsers: {},
  bannedIPs: {},
  privateMessages: {},
  supportMessages: {},
  systemSettings: {
    siteLogo: 'https://j.top4top.io/p_3585vud691.jpg',
    siteTitle: 'Cold Room',
    backgroundColor: 'blue',
    loginMusic: '',
    chatMusic: '',
    loginMusicVolume: 0.5,
    chatMusicVolume: 0.5,
    partyMode: {}
  }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileData = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(fileData);
      data = { ...data, ...loaded };
      console.log('✅ Data loaded successfully');
    }
  } catch (error) {
    console.log('⚠️ Starting with fresh data');
  }
}

function saveData() {
  try {
    data.users = Object.fromEntries(users);
    data.rooms = Object.fromEntries(rooms);
    data.mutedUsers = Object.fromEntries(mutedUsers);
    data.bannedUsers = Object.fromEntries(bannedUsers);
    data.bannedIPs = Object.fromEntries(bannedIPs);
    data.privateMessages = Object.fromEntries(privateMessages);
    data.supportMessages = Object.fromEntries(supportMessages);
    data.systemSettings = systemSettings;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ Save error:', error);
  }
}

loadData();

const users = new Map(Object.entries(data.users || {}));
const rooms = new Map(Object.entries(data.rooms || {}));
const mutedUsers = new Map(Object.entries(data.mutedUsers || {}));
const bannedUsers = new Map(Object.entries(data.bannedUsers || {}));
const bannedIPs = new Map(Object.entries(data.bannedIPs || {}));
const privateMessages = new Map(Object.entries(data.privateMessages || {}));
const supportMessages = new Map(Object.entries(data.supportMessages || {}));
const onlineUsers = new Map();
let systemSettings = data.systemSettings;

// Auto-save every 30 seconds
setInterval(() => {
  try {
    saveData();
  } catch (error) {
    console.error('❌ Auto-save error:', error);
  }
}, 30000);

// ═══════════════════════════════════════════════════════════════
// INITIALIZE OWNER & GLOBAL ROOM
// ═══════════════════════════════════════════════

function createOwner() {
  const ownerId = 'owner_cold_001';
  if (!users.has(ownerId)) {
    const owner = {
      id: ownerId,
      username: 'COLDKING',
      displayName: 'Cold Room King',
      password: bcrypt.hashSync('ColdKing@2025', 10),
      isOwner: true,
      avatar: '👑',
      gender: 'prince',
      specialBadges: ['👑'],
      joinDate: new Date().toISOString(),
      canSendImages: true,
      canSendVideos: true
    };
    users.set(ownerId, owner);
    privateMessages.set(ownerId, {});
    console.log('✅ Owner: COLDKING / ColdKing@2025');
  }
}

function createGlobalRoom() {
  const globalId = 'global_cold';
  if (!rooms.has(globalId)) {
    const globalRoom = {
      id: globalId,
      name: '❄️ Cold Room - Global',
      description: 'Main room for everyone',
      createdBy: 'Cold Room King',
      creatorId: 'owner_cold_001',
      users: [],
      messages: [],
      isOfficial: true,
      moderators: [],
      isSilenced: false,
      createdAt: new Date().toISOString()
    };
    rooms.set(globalId, globalRoom);
    console.log('✅ Global room created');
  }
}

createOwner();
createGlobalRoom();

// ═══════════════════════════════════════════════════════════════
// CLEANUP TASKS
// ═══════════════════════════════════════════════════════════════

setInterval(() => {
  const now = Date.now();
  
  for (const [userId, lastSeen] of onlineUsers.entries()) {
    if (now - lastSeen > 300000) {
      onlineUsers.delete(userId);
    }
  }
  
  for (const [userId, muteData] of mutedUsers.entries()) {
    if (muteData.temporary && muteData.expires && now > muteData.expires) {
      if (!muteData.byOwner) {
        mutedUsers.delete(userId);
      }
    }
  }
}, 60000);

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO CONNECTION
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  socket.userIP = socket.handshake.address;

  // ───────────────────────────────────────────────────────────
  // LOGIN
  // ───────────────────────────────────────────────────────────
  socket.on('login', async (data) => {
    try {
      const { username, password } = data;
      
      if (!username || !password) {
        return socket.emit('login-error', 'Please enter all fields');
      }

      if (bannedIPs.has(socket.userIP)) {
        return socket.emit('banned-user', { reason: 'Your IP is banned' });
      }

      let userFound = null;
      let userId = null;

      for (const [id, user] of users.entries()) {
        if (user.username.toLowerCase() === username.toLowerCase()) {
          if (bcrypt.compareSync(password, user.password)) {
            userFound = user;
            userId = id;
            break;
          }
        }
      }

      if (!userFound) {
        return socket.emit('login-error', 'Invalid username or password');
      }

      if (bannedUsers.has(userId)) {
        const banInfo = bannedUsers.get(userId);
        return socket.emit('banned-user', { reason: banInfo.reason });
      }

      socket.userId = userId;
      socket.userData = userFound;
      userFound.lastActive = new Date().toISOString();
      onlineUsers.set(userId, Date.now());

      const globalRoom = rooms.get('global_cold');
      if (!globalRoom.users.includes(userId)) {
        globalRoom.users.push(userId);
      }
      socket.join('global_cold');
      socket.currentRoom = 'global_cold';

      socket.emit('login-success', {
        user: {
          id: userId,
          username: userFound.username,
          displayName: userFound.displayName,
          avatar: userFound.avatar,
          gender: userFound.gender,
          isOwner: userFound.isOwner || false,
          isModerator: globalRoom.moderators.includes(userId),
          canSendImages: userFound.canSendImages || false,
          canSendVideos: userFound.canSendVideos || false,
          specialBadges: userFound.specialBadges || []
        },
        room: {
          id: globalRoom.id,
          name: globalRoom.name,
          messages: globalRoom.messages.slice(-50),
          partyMode: systemSettings.partyMode[globalRoom.id] || false
        },
        systemSettings: systemSettings
      });

      io.to('global_cold').emit('user-joined', {
        username: userFound.displayName,
        avatar: userFound.avatar
      });

      updateRoomsList();
      updateUsersList('global_cold');

    } catch (error) {
      console.error('❌ Login error:', error);
      socket.emit('login-error', 'Login failed');
    }
  });

  // ───────────────────────────────────────────────────────────
  // REGISTER
  // ───────────────────────────────────────────────────────────
  socket.on('register', async (data) => {
    try {
      const { username, password, displayName, gender } = data;

      if (!username || !password || !displayName || !gender) {
        return socket.emit('register-error', 'Please fill all fields');
      }

      if (username.length < 3 || username.length > 20) {
        return socket.emit('register-error', 'Username: 3-20 characters');
      }

      if (password.length < 6) {
        return socket.emit('register-error', 'Password: 6+ characters');
      }

      for (const user of users.values()) {
        if (user.username.toLowerCase() === username.toLowerCase()) {
          return socket.emit('register-error', 'Username exists');
        }
      }

      const userId = uuidv4();
      const newUser = {
        id: userId,
        username: username,
        displayName: displayName,
        password: bcrypt.hashSync(password, 10),
        avatar: gender === 'prince' ? '👨' : '👩',
        gender: gender,
        joinDate: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        canSendImages: true,
        canSendVideos: true
      };
      users.set(userId, newUser);
      privateMessages.set(userId, {});

      socket.emit('register-success', { 
        message: 'Account created! Please login.', 
        username: username 
      });
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Register error:', error);
      socket.emit('register-error', 'Registration failed');
    }
  });

  // ───────────────────────────────────────────────────────────
  // CHANGE DISPLAY NAME (Available to all users)
  // ───────────────────────────────────────────────────────────
  socket.on('change-display-name', async (data) => {
    try {
      const { newDisplayName } = data;
      if (!socket.userId || !newDisplayName || newDisplayName.length < 2 || newDisplayName.length > 30) {
        return socket.emit('error', 'Invalid name (2-30 chars)');
      }

      // Check uniqueness
      let nameExists = false;
      for (const user of users.values()) {
        if (user.displayName.toLowerCase() === newDisplayName.toLowerCase() && user.id !== socket.userId) {
          nameExists = true;
          break;
        }
      }
      if (nameExists) {
        return socket.emit('error', 'Display name already taken');
      }

      const user = users.get(socket.userId);
      if (user) {
        user.displayName = newDisplayName;
        socket.userData.displayName = newDisplayName;
        socket.emit('display-name-changed', { displayName: newDisplayName });
        io.to(socket.currentRoom).emit('user-name-changed', { 
          userId: socket.userId, 
          newName: newDisplayName 
        });
        setTimeout(() => saveData(), 100);
        socket.emit('action-success', 'Name changed');
      }
    } catch (error) {
      console.error('❌ Name change error:', error);
      socket.emit('error', 'Failed to change name');
    }
  });

  // ───────────────────────────────────────────────────────────
  // MAKE MODERATOR
  // ───────────────────────────────────────────────────────────
  socket.on('make-moderator', async (data) => {
    try {
      const { userId, roomId } = data;
      const user = users.get(socket.userId);
      const room = rooms.get(roomId);
      if (!user || !user.isOwner || !room) return;

      if (!room.moderators.includes(userId)) {
        room.moderators.push(userId);
        io.to(roomId).emit('moderator-added', { userId, roomId });
        socket.emit('action-success', 'Moderator added');
        setTimeout(() => saveData(), 100);
      }
    } catch (error) {
      console.error('❌ Moderator error:', error);
    }
  });

  socket.on('remove-moderator', async (data) => {
    try {
      const { userId, roomId } = data;
      const user = users.get(socket.userId);
      const room = rooms.get(roomId);
      if (!user || !user.isOwner || !room) return;

      const index = room.moderators.indexOf(userId);
      if (index > -1) {
        room.moderators.splice(index, 1);
        io.to(roomId).emit('moderator-removed', { userId, roomId });
        socket.emit('action-success', 'Moderator removed');
        setTimeout(() => saveData(), 100);
      }
    } catch (error) {
      console.error('❌ Remove moderator error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // MESSAGE HANDLING
  // ───────────────────────────────────────────────────────────
  socket.on('send-message', async (data) => {
    try {
      const { message, roomId } = data;
      const user = users.get(socket.userId);
      const room = rooms.get(roomId || socket.currentRoom);
      if (!user || !room || (!user.isOwner && room.isSilenced)) return;

      const messageId = uuidv4();
      const now = new Date().toISOString();
      const newMessage = {
        id: messageId,
        from: user.displayName,
        fromId: socket.userId,
        message: message.trim().substring(0, 500),
        timestamp: now,
        isEdited: false,
        editableBy: ['owner', 'moderator', 'sender'] // Allow all to edit own messages
      };

      room.messages.push(newMessage);
      if (room.messages.length > 50) room.messages.shift();

      io.to(roomId || socket.currentRoom).emit('new-message', newMessage);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Message error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // EDIT MESSAGE (Available to all for their own messages)
  // ───────────────────────────────────────────────────────────
  socket.on('edit-message', async (data) => {
    try {
      const { messageId, newText, roomId } = data;
      const room = rooms.get(roomId || socket.currentRoom);
      if (!room) return;

      const message = room.messages.find(m => m.id === messageId);
      if (!message || message.fromId !== socket.userId) {
        return socket.emit('error', 'Cannot edit this message');
      }

      // Allow edit within 5 minutes
      const messageTime = new Date(message.timestamp).getTime();
      const now = Date.now();
      if (now - messageTime > 300000) {
        return socket.emit('error', 'Cannot edit old messages');
      }

      message.message = newText.trim().substring(0, 500);
      message.isEdited = true;
      message.editedAt = new Date().toISOString();

      io.to(roomId || socket.currentRoom).emit('message-edited', {
        messageId,
        newText: message.message + ' (edited)',
        editedAt: message.editedAt
      });
      setTimeout(() => saveData(), 100);
      socket.emit('action-success', 'Message edited');

    } catch (error) {
      console.error('❌ Edit message error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // JOIN ROOM
  // ───────────────────────────────────────────────────────────
  socket.on('join-room', (data) => {
    try {
      const { roomId } = data;
      const room = rooms.get(roomId);
      if (!room) return socket.emit('error', 'Room not found');

      if (room.hasPassword && room.password && room.password !== data.password) {
        return socket.emit('error', 'Invalid password');
      }

      // Leave previous room if not official
      if (socket.currentRoom && !rooms.get(socket.currentRoom)?.isOfficial) {
        const prevRoom = rooms.get(socket.currentRoom);
        const prevIndex = prevRoom.users.indexOf(socket.userId);
        if (prevIndex > -1) prevRoom.users.splice(prevIndex, 1);
      }

      socket.leave(socket.currentRoom);
      socket.join(roomId);
      socket.currentRoom = roomId;

      if (!room.users.includes(socket.userId)) {
        room.users.push(socket.userId);
      }

      socket.emit('room-joined', {
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
          messages: room.messages.slice(-50),
          partyMode: systemSettings.partyMode[room.id] || false,
          isSilenced: room.isSilenced || false
        }
      });

      updateUsersList(roomId);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Join room error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // CREATE ROOM
  // ───────────────────────────────────────────────────────────
  socket.on('create-room', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;

      const { name, description, hasPassword, password } = data;
      if (!name || name.length < 3) return socket.emit('error', 'Room name too short');

      const roomId = 'room_' + uuidv4().substring(0, 8);
      const newRoom = {
        id: roomId,
        name: name,
        description: description || '',
        createdBy: user.displayName,
        creatorId: socket.userId,
        users: [socket.userId],
        messages: [],
        isOfficial: false,
        moderators: [],
        isSilenced: false,
        hasPassword: hasPassword || false,
        password: hasPassword ? password : '',
        createdAt: new Date().toISOString()
      };

      rooms.set(roomId, newRoom);
      socket.emit('room-created', { roomId });
      updateRoomsList();
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Create room error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // UPDATE ROOM
  // ───────────────────────────────────────────────────────────
  socket.on('update-room', async (data) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(data.roomId);
      if (!user || !room || user.id !== room.creatorId) return;

      if (data.name) room.name = data.name;
      if (data.description !== undefined) room.description = data.description;
      if (data.hasPassword !== undefined) {
        room.hasPassword = data.hasPassword;
        room.password = data.hasPassword ? data.password : '';
      }

      io.to(data.roomId).emit('room-updated', room);
      socket.emit('action-success', 'Room updated');
      updateRoomsList();
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Update room error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // CLEAN ROOM (Specific or All)
  // ───────────────────────────────────────────────────────────
  socket.on('clean-room', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      if (data.allRooms) {
        rooms.forEach(room => {
          if (!room.isOfficial) room.messages = [];
        });
        io.emit('chat-cleaned', { message: 'All rooms cleaned by owner' });
      } else {
        const room = rooms.get(data.roomId);
        if (room) {
          room.messages = [];
          io.to(data.roomId).emit('chat-cleaned', { message: `Room ${room.name} cleaned` });
        }
      }
      setTimeout(() => saveData(), 100);
      socket.emit('action-success', 'Room(s) cleaned');

    } catch (error) {
      console.error('❌ Clean room error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // DELETE MESSAGE (Owner/Mod/Sender)
  // ───────────────────────────────────────────────────────────
  socket.on('delete-message', async (data) => {
    try {
      const { messageId, roomId } = data;
      const user = users.get(socket.userId);
      const room = rooms.get(roomId || socket.currentRoom);
      if (!room) return;

      const message = room.messages.find(m => m.id === messageId);
      if (!message) return;

      const isOwner = user.isOwner;
      const isMod = room.moderators.includes(socket.userId);
      const isSender = message.fromId === socket.userId;

      if (!isOwner && !isMod && !isSender) {
        return socket.emit('error', 'No permission to delete');
      }

      const index = room.messages.findIndex(m => m.id === messageId);
      if (index > -1) room.messages.splice(index, 1);

      io.to(roomId || socket.currentRoom).emit('message-deleted', { messageId });
      setTimeout(() => saveData(), 100);
      socket.emit('action-success', 'Message deleted');

    } catch (error) {
      console.error('❌ Delete message error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // MUTE/BAN/SILENCE (Enhanced)
  // ───────────────────────────────────────────────────────────
  socket.on('mute-user', async (data) => {
    try {
      const { targetUserId, temporary, duration, reason } = data;
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      const muteData = {
        byOwner: true,
        temporary: temporary || false,
        duration: duration || 0,
        reason: reason || 'Muted',
        username: users.get(targetUserId)?.displayName || 'Unknown'
      };

      if (muteData.temporary) {
        muteData.expires = Date.now() + (duration * 60000);
      }

      mutedUsers.set(targetUserId, muteData);
      io.to(targetUserId).emit('user-muted', muteData);
      socket.emit('action-success', `User muted`);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Mute error:', error);
    }
  });

  socket.on('ban-user', async (data) => {
    try {
      const { targetUserId, reason } = data;
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      bannedUsers.set(targetUserId, {
        reason: reason || 'Banned',
        byOwner: true,
        timestamp: new Date().toISOString(),
        username: users.get(targetUserId)?.displayName || 'Unknown'
      });

      io.to(targetUserId).emit('banned', { reason });
      socket.emit('action-success', 'User banned');
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Ban error:', error);
    }
  });

  socket.on('silence-room', async (data) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(data.roomId);
      if (!user || !user.isOwner || !room) return;

      room.isSilenced = data.silenced;
      io.to(data.roomId).emit(room.isSilenced ? 'room-silenced' : 'room-unsilenced', {
        message: room.isSilenced ? `${room.name} silenced` : `${room.name} unsilenced`
      });
      socket.emit('action-success', 'Room silenced toggled');
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Silence room error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // PARTY MODE
  // ───────────────────────────────────────────────────────────
  socket.on('toggle-party', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      const roomId = data.roomId || socket.currentRoom;
      systemSettings.partyMode[roomId] = data.enabled;
      io.to(roomId).emit('party-mode-changed', { enabled: data.enabled });
      socket.emit('action-success', 'Party mode toggled');
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Party mode error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // YOUTUBE (With Size Control)
  // ───────────────────────────────────────────────────────────
  socket.on('start-youtube', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || (!user.isOwner && !user.isModerator)) return; // Mods can start too

      const { videoId, size } = data; // size: 'small', 'medium', 'large'
      io.emit('youtube-started', { videoId, size, startedBy: user.displayName });
      socket.emit('action-success', 'Video started');

    } catch (error) {
      console.error('❌ YouTube start error:', error);
    }
  });

  socket.on('change-youtube-size', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return; // Only owner changes size

      const { size } = data;
      io.emit('youtube-size-changed', { size });
      socket.emit('action-success', 'Video size changed');

    } catch (error) {
      console.error('❌ YouTube size error:', error);
    }
  });

  socket.on('stop-youtube', () => {
    try {
      const user = users.get(socket.userId);
      if (!user || (!user.isOwner && !user.isModerator)) return;

      io.emit('youtube-stopped');
      socket.emit('action-success', 'Video stopped');

    } catch (error) {
      console.error('❌ Stop YouTube error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // IMAGE/VIDEO
  // ───────────────────────────────────────────────────────────
  socket.on('send-image', async (data) => {
    try {
      const { imageUrl, roomId } = data;
      const user = users.get(socket.userId);
      const room = rooms.get(roomId || socket.currentRoom);
      if (!user || !room) return;

      const messageId = uuidv4();
      const now = new Date().toISOString();
      const newMessage = {
        id: messageId,
        from: user.displayName,
        fromId: socket.userId,
        type: 'image',
        imageUrl: imageUrl,
        timestamp: now
      };

      room.messages.push(newMessage);
      if (room.messages.length > 50) room.messages.shift();

      io.to(roomId || socket.currentRoom).emit('new-message', newMessage);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Image error:', error);
    }
  });

  socket.on('send-video', async (data) => {
    try {
      const { videoUrl, roomId } = data;
      const user = users.get(socket.userId);
      const room = rooms.get(roomId || socket.currentRoom);
      if (!user || !room) return;

      const messageId = uuidv4();
      const now = new Date().toISOString();
      const newMessage = {
        id: messageId,
        from: user.displayName,
        fromId: socket.userId,
        type: 'video',
        videoUrl: videoUrl,
        timestamp: now
      };

      room.messages.push(newMessage);
      if (room.messages.length > 50) room.messages.shift();

      io.to(roomId || socket.currentRoom).emit('new-message', newMessage);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Video error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // PRIVATE MESSAGES
  // ───────────────────────────────────────────────────────────
  socket.on('send-private-message', async (data) => {
    try {
      const { toUserId, message } = data;
      const user = users.get(socket.userId);
      if (!user || !toUserId || !message) return;

      const messageId = 'pm_' + uuidv4();
      const now = new Date().toISOString();
      const newMessage = {
        id: messageId,
        from: user.displayName,
        fromId: socket.userId,
        to: toUserId,
        message: message.trim().substring(0, 500),
        timestamp: now
      };

      if (!privateMessages.has(socket.userId)) privateMessages.set(socket.userId, []);
      if (!privateMessages.has(toUserId)) privateMessages.set(toUserId, []);
      
      privateMessages.get(socket.userId).push(newMessage);
      privateMessages.get(toUserId).push(newMessage);

      socket.emit('private-message-sent', newMessage);
      io.to(toUserId).emit('new-private-message', newMessage);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Private message error:', error);
    }
  });

  socket.on('get-private-messages', (data) => {
    try {
      const { withUserId } = data;
      if (!privateMessages.has(socket.userId) || !privateMessages.has(withUserId)) {
        return socket.emit('private-messages-list', { messages: [], withUserId });
      }

      const messages = privateMessages.get(socket.userId).filter(m => 
        (m.fromId === socket.userId && m.to === withUserId) || 
        (m.fromId === withUserId && m.to === socket.userId)
      ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      socket.emit('private-messages-list', { messages, withUserId });
    } catch (error) {
      console.error('❌ Get PM error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // SUPPORT MESSAGES
  // ───────────────────────────────────────────────────────────
  socket.on('send-support-message', async (data) => {
    try {
      const messageId = 'support_' + uuidv4();
      supportMessages.set(messageId, {
        id: messageId,
        from: data.from || 'Anonymous',
        message: data.message.trim().substring(0, 500),
        sentAt: new Date().toISOString(),
        fromIP: socket.userIP
      });

      socket.emit('support-message-sent', { message: 'Message sent' });
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Support error:', error);
    }
  });

  socket.on('get-support-messages', async () => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      const messages = Array.from(supportMessages.values());
      socket.emit('support-messages-list', messages);

    } catch (error) {
      console.error('❌ Get support error:', error);
    }
  });

  socket.on('delete-support-message', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      supportMessages.delete(data.messageId);
      socket.emit('action-success', 'Message deleted');
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Delete support error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // SETTINGS (Apply to all, including login screen via body class)
  // ───────────────────────────────────────────────────────────
  socket.on('update-settings', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      if (data.siteLogo) systemSettings.siteLogo = data.siteLogo;
      if (data.siteTitle) systemSettings.siteTitle = data.siteTitle;
      if (data.backgroundColor) systemSettings.backgroundColor = data.backgroundColor;
      if (data.loginMusic !== undefined) systemSettings.loginMusic = data.loginMusic;
      if (data.chatMusic !== undefined) systemSettings.chatMusic = data.chatMusic;
      if (data.loginMusicVolume !== undefined) systemSettings.loginMusicVolume = parseFloat(data.loginMusicVolume);
      if (data.chatMusicVolume !== undefined) systemSettings.chatMusicVolume = parseFloat(data.chatMusicVolume);

      // Emit to all connected, including login screen
      io.emit('settings-updated', systemSettings);
      socket.emit('action-success', 'Settings saved');
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Settings error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // GET LISTS
  // ───────────────────────────────────────────────────────────
  socket.on('get-rooms', () => updateRoomsList(socket));
  socket.on('get-users', (data) => updateUsersList(data.roomId, socket));
  
  socket.on('get-muted-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      const list = Array.from(mutedUsers.entries()).map(([userId, info]) => {
        const targetUser = users.get(userId);
        return {
          userId: userId,
          username: targetUser?.displayName || info.username || 'Unknown',
          ...info
        };
      });

      socket.emit('muted-list', list);
    } catch (error) {
      console.error('❌ Get muted error:', error);
    }
  });

  socket.on('get-banned-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.isOwner) return;

      const list = Array.from(bannedUsers.entries()).map(([userId, info]) => {
        const targetUser = users.get(userId);
        return {
          userId: userId,
          username: targetUser?.displayName || info.username || 'Unknown',
          ...info
        };
      });

      socket.emit('banned-list', list);
    } catch (error) {
      console.error('❌ Get banned error:', error);
    }
  });

  // ───────────────────────────────────────────────────────────
  // DISCONNECT (Improved reconnection handling)
  // ───────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    try {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        
        // Don't remove from official rooms
        rooms.forEach(room => {
          if (!room.isOfficial) {
            const index = room.users.indexOf(socket.userId);
            if (index > -1) room.users.splice(index, 1);
          }
        });
      }
      console.log('🔌 Disconnect:', socket.id, reason);
    } catch (error) {
      console.error('❌ Disconnect error:', error);
    }
  });

  socket.on('ping', () => {
    try {
      if (socket.userId) {
        onlineUsers.set(socket.userId, Date.now());
      }
    } catch (error) {
      console.error('❌ Ping error:', error);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function updateRoomsList(socket = null) {
  try {
    const roomList = Array.from(rooms.values())
      .map(room => ({
        id: room.id,
        name: room.name,
        description: room.description,
        userCount: room.users.length,
        hasPassword: room.hasPassword,
        isOfficial: room.isOfficial,
        createdBy: room.createdBy
      }))
      .sort((a, b) => {
        if (a.isOfficial) return -1;
        if (b.isOfficial) return 1;
        return b.userCount - a.userCount;
      });

    if (socket) {
      socket.emit('rooms-list', roomList);
    } else {
      io.emit('rooms-list', roomList);
    }
  } catch (error) {
    console.error('❌ Update rooms error:', error);
  }
}

function updateUsersList(roomId, socket = null) {
  try {
    const room = rooms.get(roomId);
    if (!room) return;

    const userList = room.users.map(userId => {
      const user = users.get(userId);
      if (!user) return null;

      return {
        id: userId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        isOnline: onlineUsers.has(userId),
        isOwner: user.isOwner || false,
        isModerator: room.moderators.includes(userId),
        specialBadges: user.specialBadges || []
      };
    }).filter(Boolean).filter(u => onlineUsers.has(u.id));

    if (socket) {
      socket.emit('users-list', userList);
    } else {
      io.to(roomId).emit('users-list', userList);
    }
  } catch (error) {
    console.error('❌ Update users error:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

process.on('uncaughtException', (error) => {
  console.error('❌ Exception:', error);
  saveData();
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Rejection:', error);
  saveData();
});

process.on('SIGINT', () => {
  console.log('\n💾 Saving before exit...');
  saveData();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n💾 Saving before termination...');
  saveData();
  process.exit(0);
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║           ❄️  Cold Room Server V2 - Fixed Edition         ║
║                                                            ║
║  Port:        ${PORT.toString().padEnd(44)}║
║  Status:      ✅ Running                                  ║
║  Data:        💾 Persistent (Auto-save 30s)               ║
║  Messages:    📝 Max 50 per room                          ║
║  Owner:       👑 COLDKING / ColdKing@2025                 ║
║                                                            ║
║  Features:    ✅ Images, Videos, YouTube (Resizable)      ║
║               ✅ Mute (Temp/Perm), Mods, Ban, Party Mode  ║
║               ✅ Private Msg, Edit Msg (All Users)        ║
║               ✅ Change Name (Unique), Gender             ║
║               ✅ Reconnection, Music, Themes (Login Too)  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});
