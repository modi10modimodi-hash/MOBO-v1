const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Socket.IO with explicit CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;

// Explicit CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.static(__dirname));
app.use(express.json({ limit: '100mb' }));

app.get('/', (req, res) => {
  console.log('🌐 Serving index.html'); // تشخيص
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ═══════════════════════════════════════════════════════════════
// DATA STORAGE (unchanged)
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
      console.log('✅ Data loaded');
    } else {
      console.log('⚠️ Fresh data');
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

// Auto-save
setInterval(saveData, 30000);

// Initialize owner and global room (unchanged)
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
    console.log('✅ Owner created');
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

// Cleanup (unchanged)
setInterval(() => {
  const now = Date.now();
  for (const [userId, lastSeen] of onlineUsers.entries()) {
    if (now - lastSeen > 300000) onlineUsers.delete(userId);
  }
  for (const [userId, muteData] of mutedUsers.entries()) {
    if (muteData.temporary && muteData.expires && now > muteData.expires && !muteData.byOwner) {
      mutedUsers.delete(userId);
    }
  }
}, 60000);

// ═══════════════════════════════════════════════════════════════
// SOCKET CONNECTION
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('🔗 Connection from:', socket.id); // تشخيص

  socket.on('login', async (data, callback) => {
    console.log('🔐 Login received:', data.username); // تشخيص
    try {
      const { username, password } = data;
      if (!username || !password) {
        console.log('❌ Login: Missing fields');
        socket.emit('login-error', 'Please enter all fields');
        if (callback) callback({ error: 'Missing fields' });
        return;
      }

      if (bannedIPs.has(socket.userIP)) {
        socket.emit('banned-user', { reason: 'Your IP is banned' });
        if (callback) callback({ error: 'IP banned' });
        return;
      }

      let userFound = null;
      let userId = null;
      for (const [id, user] of users.entries()) {
        if (user.username.toLowerCase() === username.toLowerCase() && bcrypt.compareSync(password, user.password)) {
          userFound = user;
          userId = id;
          break;
        }
      }

      if (!userFound) {
        console.log('❌ Login: Invalid credentials');
        socket.emit('login-error', 'Invalid username or password');
        if (callback) callback({ error: 'Invalid credentials' });
        return;
      }

      if (bannedUsers.has(userId)) {
        const banInfo = bannedUsers.get(userId);
        socket.emit('banned-user', { reason: banInfo.reason });
        if (callback) callback({ error: 'Banned' });
        return;
      }

      socket.userId = userId;
      socket.userData = userFound;
      userFound.lastActive = new Date().toISOString();
      onlineUsers.set(userId, Date.now());

      const globalRoom = rooms.get('global_cold');
      if (!globalRoom.users.includes(userId)) globalRoom.users.push(userId);
      socket.join('global_cold');
      socket.currentRoom = 'global_cold';

      const response = {
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
      };

      console.log('✅ Login success:', username); // تشخيص
      socket.emit('login-success', response);
      if (callback) callback({ success: true }); // callback للكلاينت

      io.to('global_cold').emit('user-joined', { username: userFound.displayName, avatar: userFound.avatar });
      updateRoomsList();
      updateUsersList('global_cold');

    } catch (error) {
      console.error('❌ Login error:', error);
      socket.emit('login-error', 'Login failed');
      if (callback) callback({ error: 'Server error' });
    }
  });

  // باقي الـ events (register, send-message, إلخ) - انسخ من الرد السابق للاختصار، أو استخدم الكامل من قبل
  // ... (الكود الكامل للباقي)

  socket.on('disconnect', (reason) => {
    console.log('🔌 Disconnect:', reason); // تشخيص
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      rooms.forEach(room => {
        if (!room.isOfficial) {
          const index = room.users.indexOf(socket.userId);
          if (index > -1) room.users.splice(index, 1);
        }
      });
    }
  });
});

// Helper functions (updateRoomsList, updateUsersList) - unchanged
function updateRoomsList(socket = null) {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    name: room.name,
    description: room.description,
    userCount: room.users.length,
    hasPassword: room.hasPassword,
    isOfficial: room.isOfficial,
    createdBy: room.createdBy
  })).sort((a, b) => {
    if (a.isOfficial) return -1;
    if (b.isOfficial) return 1;
    return b.userCount - a.userCount;
  });

  if (socket) socket.emit('rooms-list', roomList);
  else io.emit('rooms-list', roomList);
}

function updateUsersList(roomId, socket = null) {
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

  if (socket) socket.emit('users-list', userList);
  else io.to(roomId).emit('users-list', userList);
}

// Error handling (unchanged)
process.on('uncaughtException', (error) => {
  console.error('❌ Exception:', error);
  saveData();
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Rejection:', error);
  saveData();
});

process.on('SIGINT', () => {
  console.log('\n💾 Saving...');
  saveData();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n💾 Saving...');
  saveData();
  process.exit(0);
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔════════════════════════════════════════════════════════════╗
║           ❄️  Cold Room Server V2 - Ready                 ║
║  Port: ${PORT}                                              ║
║  Status: ✅ Running                                        ║
╚════════════════════════════════════════════════════════════╝\n`);
});
