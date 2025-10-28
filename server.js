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

  // LOGIN
  socket.on('login', (data) => {
    try {
      const { username, password } = data;
      let userFound, userId;
      for (const [id, user] of users.entries()) {
        if (user.username.toLowerCase() === username.toLowerCase() &&
            bcrypt.compareSync(password, user.password)) {
          userFound = user; userId = id; break;
        }
      }
      if (!userFound) return socket.emit('login-error', 'Invalid credentials');
      if (bannedUsers.has(userId)) return socket.emit('banned-user', { reason: 'Banned' });

      socket.userId = userId;
      socket.userData = userFound;
      onlineUsers.set(userId, Date.now());

      const globalRoom = rooms.get('global_cold');
      if (!globalRoom.users.includes(userId)) globalRoom.users.push(userId);
      socket.join('global_cold');
      socket.currentRoom = 'global_cold';

      socket.emit('login-success', {
        user: {
          id: userId,
          username: userFound.username,
          displayName: userFound.displayName,
          avatar: userFound.avatar,
          gender: userFound.gender,
          isOwner: userFound.isOwner,
          isModerator: globalRoom.moderators.includes(userId),
          canSendImages: userFound.canSendImages,
          canSendVideos: userFound.canSendVideos,
          specialBadges: userFound.specialBadges || []
        },
        room: {
          id: globalRoom.id,
          name: globalRoom.name,
          messages: globalRoom.messages.slice(-50),
          partyMode: systemSettings.partyMode[globalRoom.id] || false
        },
        systemSettings,
        youtube: systemSettings.youtube
      });

      updateRoomsList();
      updateUsersList('global_cold');
    } catch (e) { console.error(e); }
  });

  // REGISTER
  socket.on('register', (data) => {
    try {
      const { username, password, displayName, gender } = data;
      for (const u of users.values()) {
        if (u.username.toLowerCase() === username.toLowerCase())
          return socket.emit('register-error', 'Username exists');
        if (u.displayName.toLowerCase() === displayName.toLowerCase())
          return socket.emit('register-error', 'Display name exists');
      }
      const userId = 'user_' + uuidv4();
      users.set(userId, {
        id: userId,
        username,
        displayName,
        password: bcrypt.hashSync(password, 10),
        isOwner: false,
        joinDate: new Date().toISOString(),
        avatar: gender === 'prince' ? '🤴' : '👸',
        gender,
        specialBadges: [],
        canSendImages: false,
        canSendVideos: false
      });
      privateMessages.set(userId, {});
      socket.emit('register-success', { message: 'Account created!', username });
      saveData();
    } catch (e) { console.error(e); }
  });

  // SEND MESSAGE
  socket.on('send-message', (data) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(socket.currentRoom);
      if (!user || !room) return;
      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        text: (data.text || '').substring(0, 500),
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: user.isOwner,
        isModerator: room.moderators.includes(socket.userId),
        roomId: socket.currentRoom,
        edited: false,
        isImage: false,
        isVideo: false
      };
      room.messages.push(message);
      if (room.messages.length > 200) room.messages = room.messages.slice(-200);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) { console.error(e); }
  });

  // EDIT MESSAGE
  socket.on('edit-message', (data) => {
    try {
      const room = rooms.get(socket.currentRoom);
      if (!
