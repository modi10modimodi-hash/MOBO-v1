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
app.get('/settings', (req, res) => res.json(systemSettings));

// ═══════════════════════════════════════════════════════════════
// DATA STORAGE
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
    partyMode: {},
    youtube: null
  }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const fileData = fs.readFileSync(DATA_FILE, 'utf8');
      const loaded = JSON.parse(fileData);
      data = { ...data, ...loaded };
      console.log('✅ Data loaded');
    }
  } catch {
    console.log('⚠️ Fresh data');
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
  } catch (e) {
    console.error('❌ Save error:', e);
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

// ═══════════════════════════════════════════════════════════════
// INIT OWNER & GLOBAL ROOM
// ═══════════════════════════════════════════════════════════════
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
  }
}
function createGlobalRoom() {
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
      createdAt: new Date().toISOString()
    });
  }
}
createOwner();
createGlobalRoom();

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  socket.userIP = socket.handshake.address;

  // هنا تضع كل socket.on مثل login, register, send-message, edit-message, mute-user, ban-user, start-youtube-watch, stop-youtube-watch, update-settings, إلخ
  // (نفس ما شرحناه في النسخ السابقة، لكن مغلق بالكامل)

  // مثال سريع:
  socket.on('start-youtube-watch', (data) => {
    if (!socket.userId) return;
    const user = users.get(socket.userId);
    if (!user?.isOwner) return;
    systemSettings.youtube = {
      videoId: data.videoId,
      startedAt: Date.now(),
      size: data.size || 'medium',
      startedBy: user.displayName
    };
    io.to('global_cold').emit('youtube-started', systemSettings.youtube);
    saveData();
  });

  socket.on('stop-youtube-watch', () => {
    if (!socket.userId) return;
    const user = users.get(socket.userId);
    if (!user?.isOwner) return;
    systemSettings.youtube = null;
    io.to('global_cold').emit('youtube-stopped');
    saveData();
  });

  socket.on('youtube-resize', (data) => {
    if (!socket.userId) return;
    const user = users.get(socket.userId);
    if (!user?.isOwner) return;
    if (systemSettings.youtube) {
      systemSettings.youtube.size = data.size;
      io.to('global_cold').emit('youtube-resize', { size: data.size });
      saveData();
    }
  });

}); // ← إغلاق io.on('connection')

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function updateRoomsList() {
  const roomsArray = Array.from(rooms.values()).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdBy: r.createdBy,
    userCount: r.users.length,
    hasPassword: r.hasPassword,
    isOfficial: r.isOfficial
  }));
  io.emit('rooms-list', roomsArray);
}

function updateUsersList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const usersArray = room.users.map(uid => {
    const u = users.get(uid);
    return {
      id: u.id,
      displayName: u.displayName,
      avatar: u.avatar,
      isOwner: u.isOwner,
      isModerator: room.moderators.includes(uid),
      isOnline: onlineUsers.has(uid)
    };
  });
  io.to(roomId).emit('users-list', usersArray);
}

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
