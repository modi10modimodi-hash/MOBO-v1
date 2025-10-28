// Cold Room V2 - Complete server.js
// Single-file complete implementation with one io.on('connection') block.
// Node >= 14 recommended. Uses express, socket.io, bcryptjs, uuid, fs.

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

// Data file
const DATA_FILE = 'cold_room_data.json';

// Default system settings + data container
let systemSettings = {
  siteLogo: 'https://j.top4top.io/p_3585vud691.jpg',
  siteTitle: 'Cold Room',
  backgroundColor: 'blue',
  loginMusic: '',
  chatMusic: '',
  loginMusicVolume: 0.5,
  chatMusicVolume: 0.5,
  partyMode: {},
  youtube: null
};

let data = {
  users: {},
  rooms: {},
  mutedUsers: {},
  bannedUsers: {},
  bannedIPs: {},
  privateMessages: {},
  supportMessages: {},
  systemSettings
};

// In-memory structures (Maps)
const users = new Map();
const rooms = new Map();
const mutedUsers = new Map();
const bannedUsers = new Map();
const bannedIPs = new Map();
const privateMessages = new Map();
const supportMessages = new Map();
const onlineUsers = new Map();

// Load persisted data if exists
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(content);
      data = { ...data, ...loaded };
      // restore maps
      Object.entries(data.users || {}).forEach(([k,v]) => users.set(k, v));
      Object.entries(data.rooms || {}).forEach(([k,v]) => rooms.set(k, v));
      Object.entries(data.mutedUsers || {}).forEach(([k,v]) => mutedUsers.set(k, v));
      Object.entries(data.bannedUsers || {}).forEach(([k,v]) => bannedUsers.set(k, v));
      Object.entries(data.bannedIPs || {}).forEach(([k,v]) => bannedIPs.set(k, v));
      Object.entries(data.privateMessages || {}).forEach(([k,v]) => privateMessages.set(k, v));
      Object.entries(data.supportMessages || {}).forEach(([k,v]) => supportMessages.set(k, v));
      systemSettings = loaded.systemSettings || systemSettings;
      console.log('✅ Data loaded from', DATA_FILE);
    } else {
      console.log('⚠️ Data file not found — starting fresh');
    }
  } catch (e) {
    console.error('❌ loadData error', e);
  }
}

// Save (serialize) all Maps to JSON
function saveData() {
  try {
    const toSave = {
      users: Object.fromEntries(users),
      rooms: Object.fromEntries(rooms),
      mutedUsers: Object.fromEntries(mutedUsers),
      bannedUsers: Object.fromEntries(bannedUsers),
      bannedIPs: Object.fromEntries(bannedIPs),
      privateMessages: Object.fromEntries(privateMessages),
      supportMessages: Object.fromEntries(supportMessages),
      systemSettings
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (e) {
    console.error('❌ saveData error', e);
  }
}

// Initialize default owner and global room
function createOwnerIfMissing() {
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
    console.log('✅ Owner created: COLDKING / ColdKing@2025');
  }
}

function createGlobalRoomIfMissing() {
  const globalId = 'global_cold';
  if (!rooms.has(globalId)) {
    rooms.set(globalId, {
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
      hasPassword: false,
      password: null,
      createdAt: new Date().toISOString()
    });
    console.log('✅ Global room created');
  }
}

// Helpers to broadcast lists
function updateRoomsList() {
  try {
    const roomsArray = Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdBy: r.createdBy,
      userCount: (r.users || []).length,
      hasPassword: !!r.hasPassword,
      isOfficial: !!r.isOfficial
    }));
    io.emit('rooms-list', roomsArray);
  } catch (e) {
    console.error(e);
  }
}

function updateUsersList(roomId) {
  try {
    const room = rooms.get(roomId);
    if (!room) return;
    const usersArray = (room.users || []).map(uid => {
      const u = users.get(uid);
      if (!u) return null;
      return {
        id: u.id,
        displayName: u.displayName,
        avatar: u.avatar,
        isOwner: !!u.isOwner,
        isModerator: room.moderators.includes(u.id),
        isOnline: onlineUsers.has(u.id)
      };
    }).filter(Boolean);
    io.to(roomId).emit('users-list', usersArray);
  } catch (e) {
    console.error(e);
  }
}

// Party mode setter
function setPartyMode(roomId, enabled) {
  systemSettings.partyMode = systemSettings.partyMode || {};
  systemSettings.partyMode[roomId] = !!enabled;
  io.to(roomId).emit('party-mode-changed', { enabled: !!enabled, roomId });
  saveData();
}

// Restore data and ensure owner+global room exist
loadData();
createOwnerIfMissing();
createGlobalRoomIfMissing();
saveData();

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/settings', (req, res) => res.json(systemSettings));

// Single io.on('connection') block — all socket handlers live here
io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  socket.userIP = socket.handshake.address || socket.conn.remoteAddress || '';

  // LOGIN
  socket.on('login', (payload) => {
    try {
      const { username, password } = payload || {};
      if (!username || !password) return socket.emit('login-error', 'Missing credentials');

      let foundId = null;
      for (const [id, u] of users.entries()) {
        if (u.username.toLowerCase() === username.toLowerCase() &&
            bcrypt.compareSync(password, u.password)) {
          foundId = id;
          break;
        }
      }
      if (!foundId) return socket.emit('login-error', 'Invalid credentials');
      if (bannedUsers.has(foundId)) return socket.emit('banned-user', { reason: 'Banned' });

      const user = users.get(foundId);
      socket.userId = foundId;
      socket.userData = user;
      onlineUsers.set(foundId, Date.now());

      // join global
      const globalRoom = rooms.get('global_cold');
      if (globalRoom && !globalRoom.users.includes(foundId)) globalRoom.users.push(foundId);
      socket.join('global_cold');
      socket.currentRoom = 'global_cold';

      socket.emit('login-success', {
        user: {
          id: foundId,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          gender: user.gender,
          isOwner: user.isOwner,
          isModerator: globalRoom ? globalRoom.moderators.includes(foundId) : false,
          canSendImages: user.canSendImages,
          canSendVideos: user.canSendVideos,
          specialBadges: user.specialBadges || []
        },
        room: {
          id: globalRoom.id,
          name: globalRoom.name,
          messages: (globalRoom.messages || []).slice(-50),
          partyMode: systemSettings.partyMode[globalRoom.id] || false
        },
        systemSettings,
        youtube: systemSettings.youtube
      });

      updateRoomsList();
      updateUsersList('global_cold');
    } catch (e) {
      console.error('login error', e);
    }
  });

  // REGISTER
  socket.on('register', (payload) => {
    try {
      const { username, password, displayName, gender } = payload || {};
      if (!username || !password || !displayName) return socket.emit('register-error', 'Missing fields');

      // unique checks
      for (const u of users.values()) {
        if (u.username.toLowerCase() === username.toLowerCase()) return socket.emit('register-error', 'Username exists');
        if (u.displayName.toLowerCase() === displayName.toLowerCase()) return socket.emit('register-error', 'Display name exists');
      }

      const userId = 'user_' + uuidv4();
      const newUser = {
        id: userId,
        username,
        displayName,
        password: bcrypt.hashSync(password, 10),
        isOwner: false,
        joinDate: new Date().toISOString(),
        avatar: gender === 'prince' ? '🤴' : '👸',
        gender: gender || 'unknown',
        specialBadges: [],
        canSendImages: false,
        canSendVideos: false
      };
      users.set(userId, newUser);
      privateMessages.set(userId, {});
      saveData();
      socket.emit('register-success', { message: 'Account created!', username });
    } catch (e) {
      console.error('register error', e);
    }
  });

  // SEND MESSAGE
  socket.on('send-message', (payload) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(socket.currentRoom);
      if (!user || !room) return socket.emit('error', 'Not in room or not authenticated');

      // check muted
      const mute = mutedUsers.get(socket.userId);
      if (mute && mute.expires && Date.now() > mute.expires) mutedUsers.delete(socket.userId);
      if (mutedUsers.has(socket.userId)) return socket.emit('error', 'You are muted');

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        text: (payload.text || '').toString().substring(0, 1000),
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: !!user.isOwner,
        isModerator: room.moderators.includes(socket.userId),
        roomId: socket.currentRoom,
        edited: false,
        isImage: false,
        isVideo: false
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error('send-message error', e);
    }
  });

  // EDIT MESSAGE (user can edit only own messages)
  socket.on('edit-message', (payload) => {
    try {
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const idx = (room.messages || []).findIndex(m => m.id === payload.messageId && m.userId === socket.userId);
      if (idx === -1) return socket.emit('error', 'Message not found or permission denied');
      room.messages[idx].text = (payload.newText || '').toString().substring(0, 1000);
      room.messages[idx].edited = true;
      io.to(socket.currentRoom).emit('message-edited', { messageId: payload.messageId, newText: room.messages[idx].text });
      saveData();
    } catch (e) {
      console.error('edit-message error', e);
    }
  });

  // SEND IMAGE (permission-controlled)
  socket.on('send-image', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.canSendImages) return socket.emit('error', 'No permission to send images');
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        imageUrl: payload.imageUrl || '',
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: !!user.isOwner,
        roomId: socket.currentRoom,
        isImage: true,
        isVideo: false
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error('send-image error', e);
    }
  });

  // SEND VIDEO (permission-controlled)
  socket.on('send-video', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.canSendVideos) return socket.emit('error', 'No permission to send videos');
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        videoUrl: payload.videoUrl || '',
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: !!user.isOwner,
        roomId: socket.currentRoom,
        isImage: false,
        isVideo: true
      };
      room.messages = room.messages || [];
      room.messages.push(message);
      if (room.messages.length > 500) room.messages = room.messages.slice(-500);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) {
      console.error('send-video error', e);
    }
  });

  // ROOM MANAGEMENT: create, join, update, delete, clean
  socket.on('create-room', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      const roomId = 'room_' + uuidv4();
      const newRoom = {
        id: roomId,
        name: (payload.name || 'Untitled').toString().substring(0, 100),
        description: (payload.description || '').toString().substring(0, 500),
        createdBy: user.displayName,
        creatorId: socket.userId,
        users: [socket.userId],
        messages: [],
        isOfficial: false,
        hasPassword: !!payload.password,
        password: payload.password ? bcrypt.hashSync(payload.password.toString(), 10) : null,
        moderators: [],
        isSilenced: false,
        createdAt: new Date().toISOString()
      };
      rooms.set(roomId, newRoom);
      socket.join(roomId);
      socket.currentRoom = roomId;
      socket.emit('room-created', { roomId, roomName: newRoom.name });
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error('create-room error', e);
    }
  });

  socket.on('join-room', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return socket.emit('error', 'Not authenticated');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');

      if (room.hasPassword && !user.isOwner) {
        if (!payload.password || !bcrypt.compareSync(payload.password.toString(), room.password)) {
          return socket.emit('error', 'Wrong password');
        }
      }

      // leave previous
      if (socket.currentRoom) {
        const prev = rooms.get(socket.currentRoom);
        if (prev) prev.users = (prev.users || []).filter(u => u !== socket.userId);
        socket.leave(socket.currentRoom);
      }

      if (!room.users.includes(socket.userId)) room.users.push(socket.userId);
      socket.join(room.id);
      socket.currentRoom = room.id;

      socket.emit('room-joined', {
        room: {
          id: room.id,
          name: room.name,
          description: room.description,
          messages: (room.messages || []).slice(-50),
          isCreator: room.creatorId === socket.userId,
          isModerator: room.moderators.includes(socket.userId),
          partyMode: systemSettings.partyMode[room.id] || false
        },
        youtube: systemSettings.youtube
      });

      updateUsersList(room.id);
      saveData();
    } catch (e) {
      console.error('join-room error', e);
    }
  });

  socket.on('update-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      if (payload.name !== undefined) room.name = payload.name.toString().substring(0, 100);
      if (payload.description !== undefined) room.description = payload.description.toString().substring(0, 500);
      if (payload.password !== undefined) {
        room.hasPassword = !!payload.password;
        room.password = payload.password ? bcrypt.hashSync(payload.password.toString(), 10) : null;
      }
      io.to(room.id).emit('room-updated', { name: room.name, description: room.description });
      saveData();
    } catch (e) {
      console.error('update-room error', e);
    }
  });

  socket.on('delete-room', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room || room.isOfficial) return socket.emit('error', 'Cannot delete room');
      io.to(payload.roomId).emit('room-deleted', { message: 'Room deleted' });
      rooms.delete(payload.roomId);
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error('delete-room error', e);
    }
  });

  socket.on('clean-chat', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.messages = [];
      io.to(payload.roomId).emit('chat-cleaned', { message: 'Chat cleaned' });
      saveData();
    } catch (e) {
      console.error('clean-chat error', e);
    }
  });

  socket.on('clean-all-rooms', () => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      rooms.forEach(room => {
        room.messages = [];
        io.to(room.id).emit('chat-cleaned', { message: 'All chats cleaned' });
      });
      saveData();
    } catch (e) {
      console.error('clean-all-rooms error', e);
    }
  });

  // MODERATION: mute/unmute/ban/unban/moderator management
  socket.on('mute-user', (payload) => {
    try {
      const admin = users.get(socket.userId);
      const target = users.get(payload.userId);
      if (!admin || !target) return socket.emit('error', 'Invalid user');
      if (target.isOwner) return socket.emit('error', 'Cannot mute owner');

      const durationMin = parseInt(payload.duration) || 0; // 0 -> permanent
      const expires = durationMin > 0 ? Date.now() + durationMin * 60000 : null;
      mutedUsers.set(payload.userId, {
        username: target.displayName,
        expires,
        reason: payload.reason || 'Rule violation',
        mutedBy: admin.displayName,
        mutedById: socket.userId,
        temporary: !!expires,
        byOwner: !!admin.isOwner,
        roomId: payload.roomId || socket.currentRoom
      });
      saveData();
      socket.emit('action-success', `Muted ${target.displayName}`);
    } catch (e) {
      console.error('mute-user error', e);
    }
  });

  socket.on('unmute-user', (payload) => {
    try {
      mutedUsers.delete(payload.userId);
      saveData();
      socket.emit('action-success', 'User unmuted');
    } catch (e) {
      console.error('unmute-user error', e);
    }
  });

  socket.on('ban-user', (payload) => {
    try {
      const admin = users.get(socket.userId);
      const target = users.get(payload.userId);
      if (!admin?.isOwner) return socket.emit('error', 'Only owner can ban');
      if (!target || target.isOwner) return socket.emit('error', 'Invalid target');
      bannedUsers.set(payload.userId, {
        username: target.displayName,
        reason: payload.reason || 'Violation',
        bannedBy: admin.displayName,
        bannedAt: Date.now()
      });
      saveData();
      // disconnect target if online
      const tSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.userId);
      if (tSocket) {
        try { tSocket.emit('banned', { reason: payload.reason || 'Violation' }); tSocket.disconnect(true); } catch {}
      }
      socket.emit('action-success', `Banned ${target.displayName}`);
    } catch (e) {
      console.error('ban-user error', e);
    }
  });

  socket.on('unban-user', (payload) => {
    try {
      bannedUsers.delete(payload.userId);
      saveData();
      socket.emit('action-success', 'User unbanned');
    } catch (e) {
      console.error('unban-user error', e);
    }
  });

  socket.on('add-moderator', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      if (!room.moderators.includes(payload.userId)) room.moderators.push(payload.userId);
      saveData();
      socket.emit('action-success', `${payload.username} is now moderator`);
    } catch (e) {
      console.error('add-moderator error', e);
    }
  });

  socket.on('remove-moderator', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.moderators = (room.moderators || []).filter(id => id !== payload.userId);
      saveData();
      socket.emit('action-success', `${payload.username} removed from moderators`);
    } catch (e) {
      console.error('remove-moderator error', e);
    }
  });

  // PRIVATE MESSAGES
  socket.on('send-private-message', (payload) => {
    try {
      const sender = users.get(socket.userId);
      const receiver = users.get(payload.toUserId);
      if (!sender || !receiver) return socket.emit('error', 'Invalid users');

      const message = {
        id: 'pm_' + uuidv4(),
        from: socket.userId,
        to: payload.toUserId,
        fromName: sender.displayName,
        text: (payload.text || '').toString().substring(0, 1000),
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        edited: false
      };

      // store for sender
      if (!privateMessages.has(socket.userId)) privateMessages.set(socket.userId, {});
      const smap = privateMessages.get(socket.userId);
      if (!smap[payload.toUserId]) smap[payload.toUserId] = [];
      smap[payload.toUserId].push(message);

      // store for receiver (mirror)
      if (!privateMessages.has(payload.toUserId)) privateMessages.set(payload.toUserId, {});
      const rmap = privateMessages.get(payload.toUserId);
      if (!rmap[socket.userId]) rmap[socket.userId] = [];
      rmap[socket.userId].push(message);

      // notify receiver if online
      const receiverSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.toUserId);
      if (receiverSocket) receiverSocket.emit('new-private-message', message);

      socket.emit('private-message-sent', message);
      saveData();
    } catch (e) {
      console.error('send-private-message error', e);
    }
  });

  socket.on('get-private-messages', (payload) => {
    try {
      const list = privateMessages.get(socket.userId)?.[payload.withUserId] || [];
      socket.emit('private-messages-list', { withUserId: payload.withUserId, messages: list.slice(-200) });
    } catch (e) {
      console.error('get-private-messages error', e);
    }
  });

  // SUPPORT MESSAGES
  socket.on('send-support-message', (payload) => {
    try {
      const id = 'support_' + uuidv4();
      supportMessages.set(id, {
        id,
        from: payload.from || (socket.userId ? (users.get(socket.userId)?.displayName || 'User') : 'Anonymous'),
        message: (payload.message || '').toString().substring(0, 1000),
        sentAt: new Date().toISOString(),
        fromIP: socket.userIP || ''
      });
      saveData();
      socket.emit('support-message-sent', { message: 'Message sent' });
    } catch (e) {
      console.error('send-support-message error', e);
    }
  });

  socket.on('get-support-messages', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      socket.emit('support-messages-list', Array.from(supportMessages.values()));
    } catch (e) {
      console.error('get-support-messages error', e);
    }
  });

  socket.on('delete-support-message', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      supportMessages.delete(payload.messageId);
      saveData();
      socket.emit('action-success', 'Message deleted');
    } catch (e) {
      console.error('delete-support-message error', e);
    }
  });

  // LISTS: rooms, users, muted, banned
  socket.on('get-rooms', () => {
    try {
      const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        description: room.description,
        userCount: (room.users || []).length,
        hasPassword: !!room.hasPassword,
        isOfficial: !!room.isOfficial,
        createdBy: room.createdBy
      })).sort((a, b) => {
        if (a.isOfficial && !b.isOfficial) return -1;
        if (!a.isOfficial && b.isOfficial) return 1;
        return b.userCount - a.userCount;
      });
      socket.emit('rooms-list', roomList);
    } catch (e) {
      console.error('get-rooms error', e);
    }
  });

  socket.on('get-users', (payload) => {
    try {
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('users-list', []);
      const list = (room.users || []).map(uid => {
        const u = users.get(uid);
        if (!u) return null;
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          isOnline: onlineUsers.has(u.id),
          isOwner: !!u.isOwner,
          isModerator: room.moderators.includes(u.id),
          specialBadges: u.specialBadges || []
        };
      }).filter(Boolean);
      socket.emit('users-list', list);
    } catch (e) {
      console.error('get-users error', e);
    }
  });

  socket.on('get-muted-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      const list = Array.from(mutedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info }));
      socket.emit('muted-list', list);
    } catch (e) {
      console.error('get-muted-list error', e);
    }
  });

  socket.on('get-banned-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      const list = Array.from(bannedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info }));
      socket.emit('banned-list', list);
    } catch (e) {
      console.error('get-banned-list error', e);
    }
  });

  // DELETE ACCOUNT (owner)
  socket.on('delete-account', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const target = users.get(payload.userId);
      if (!target || target.isOwner) return socket.emit('error', 'Invalid target');

      rooms.forEach(room => {
        room.messages = (room.messages || []).filter(m => m.userId !== payload.userId);
        room.users = (room.users || []).filter(u => u !== payload.userId);
        room.moderators = (room.moderators || []).filter(m => m !== payload.userId);
      });

      users.delete(payload.userId);
      privateMessages.delete(payload.userId);
      mutedUsers.delete(payload.userId);
      bannedUsers.delete(payload.userId);

      const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === payload.userId);
      if (targetSocket) {
        try { targetSocket.emit('account-deleted', { message: 'Account deleted' }); targetSocket.disconnect(true); } catch {}
      }
      saveData();
      updateRoomsList();
      socket.emit('action-success', `Deleted: ${payload.userId}`);
    } catch (e) {
      console.error('delete-account error', e);
    }
  });

  // DELETE MESSAGE (owner)
  socket.on('delete-message', (payload) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return socket.emit('error', 'No permission');
      const room = rooms.get(payload.roomId);
      if (!room) return socket.emit('error', 'Room not found');
      room.messages = (room.messages || []).filter(m => m.id !== payload.messageId);
      io.to(payload.roomId).emit('message-deleted', { messageId: payload.messageId });
      saveData();
    } catch (e) {
      console.error('delete-message error', e);
    }
  });

  // PING / disconnect handlers
  socket.on('ping', () => {
    try {
      if (socket.userId) onlineUsers.set(socket.userId, Date.now());
    } catch (e) {
      console.error('ping error', e);
    }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        rooms.forEach(room => {
          room.users = (room.users || []).filter(u => u !== socket.userId);
        });
      }
      console.log('🔌 Disconnect:', socket.id);
    } catch (e) {
      console.error('disconnect error', e);
    }
  });

  // SETTINGS update from owner (kept here inside connection to send immediate ack)
  socket.on('update-settings', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (payload.siteLogo !== undefined) systemSettings.siteLogo = payload.siteLogo;
      if (payload.siteTitle !== undefined) systemSettings.siteTitle = payload.siteTitle;
      if (payload.backgroundColor !== undefined) systemSettings.backgroundColor = payload.backgroundColor;
      if (payload.loginMusic !== undefined) systemSettings.loginMusic = payload.loginMusic;
      if (payload.chatMusic !== undefined) systemSettings.chatMusic = payload.chatMusic;
      if (payload.loginMusicVolume !== undefined) systemSettings.loginMusicVolume = Number(payload.loginMusicVolume) || 0.5;
      if (payload.chatMusicVolume !== undefined) systemSettings.chatMusicVolume = Number(payload.chatMusicVolume) || 0.5;
      io.emit('settings-updated', systemSettings);
      saveData();
      socket.emit('action-success', 'Settings updated');
    } catch (e) {
      console.error('update-settings error', e);
    }
  });

  // Party mode toggle (owner or room moderator)
  socket.on('toggle-party-mode', (payload) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(payload.roomId || socket.currentRoom);
      if (!user || !room) return socket.emit('error', 'Invalid request');
      const allowed = user.isOwner || room.moderators.includes(socket.userId);
      if (!allowed) return socket.emit('error', 'No permission');
      setPartyMode(room.id, !!payload.enabled);
    } catch (e) {
      console.error('toggle-party-mode error', e);
    }
  });

  // YouTube watch together controls (owner)
  socket.on('start-youtube-watch', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (!payload || !payload.videoId) return socket.emit('error', 'Missing videoId');
      systemSettings.youtube = {
        videoId: payload.videoId.toString(),
        startedAt: Date.now(),
        size: payload.size || 'medium',
        startedBy: user.displayName
      };
      io.to('global_cold').emit('youtube-started', systemSettings.youtube);
      saveData();
    } catch (e) {
      console.error('start-youtube-watch error', e);
    }
  });

  socket.on('stop-youtube-watch', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      systemSettings.youtube = null;
      io.to('global_cold').emit('youtube-stopped');
      saveData();
    } catch (e) {
      console.error('stop-youtube-watch error', e);
    }
  });

  socket.on('youtube-resize', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (!systemSettings.youtube) return socket.emit('error', 'No youtube session');
      systemSettings.youtube.size = payload.size || systemSettings.youtube.size || 'medium';
      io.to('global_cold').emit('youtube-resize', { size: systemSettings.youtube.size });
      saveData();
    } catch (e) {
      console.error('youtube-resize error', e);
    }
  });

  socket.on('get-youtube-state', () => {
    try {
      socket.emit('youtube-state', systemSettings.youtube || null);
    } catch (e) {
      console.error('get-youtube-state error', e);
    }
  });
}); // END io.on('connection')

// Utility: reset data (dev)
function resetAllData() {
  users.clear();
  rooms.clear();
  mutedUsers.clear();
  bannedUsers.clear();
  bannedIPs.clear();
  privateMessages.clear();
  supportMessages.clear();
  systemSettings = {
    siteLogo: 'https://j.top4top.io/p_3585vud691.jpg',
    siteTitle: 'Cold Room',
    backgroundColor: 'blue',
    loginMusic: '',
    chatMusic: '',
    loginMusicVolume: 0.5,
    chatMusicVolume: 0.5,
    partyMode: {},
    youtube: null
  };
  createOwnerIfMissing();
  createGlobalRoomIfMissing();
  saveData();
}

// Periodic autosave
setInterval(() => {
  try { saveData(); } catch (e) { console.error(e); }
}, 30000);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Cold Room server running on port ${PORT}`);
});
