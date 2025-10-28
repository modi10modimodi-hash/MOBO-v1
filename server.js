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

// CORS middleware صريح للـ static و API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

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
  console.log('🔗 New connection:', socket.id); // تشخيص: هل يوصل الاتصال؟
  socket.userIP = socket.handshake.address;

  // ───────────────────────────────────────────────────────────
  // LOGIN (مع log للتشخيص)
  // ───────────────────────────────────────────────────────────
  socket.on('login', async (data) => {
    console.log('🔐 Login attempt:', data.username); // تشخيص
    try {
      const { username, password } = data;
      
      if (!username || !password) {
        console.log('❌ Login: Missing fields');
        return socket.emit('login-error', 'Please enter all fields');
      }

      if (bannedIPs.has(socket.userIP)) {
        console.log('🚫 IP banned');
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
        console.log('❌ Login: Invalid credentials');
        return socket.emit('login-error', 'Invalid username or password');
      }

      if (bannedUsers.has(userId)) {
        const banInfo = bannedUsers.get(userId);
        console.log('🚫 User banned');
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

      console.log('✅ Login success for:', username); // تشخيص
      socket.emit('login-success', response); // الـ emit الرئيسي

      io.to('global_cold').emit('user-joined', {
        username: userFound.displayName,
        avatar: userFound.avatar
      });

      updateRoomsList();
      updateUsersList('global_cold');

    } catch (error) {
      console.error('❌ Login error:', error); // تشخيص
      socket.emit('login-error', 'Login failed');
    }
  });

  // باقي الـ events (مثل register، send-message، إلخ) تبقى كما هي من الرد السابق - انسخها من هناك للاختصار
  // ... (انسخ باقي الكود من server.js السابق هنا، بدون تغيير)

  // الـ disconnect
  socket.on('disconnect', (reason) => {
    console.log('🔌 Disconnect:', socket.id, reason); // تشخيص
    // باقي الكود
  });
});

// باقي الكود (helper functions، error handling، start server) كما في الرد السابق
// ... (انسخ الكامل من الرد السابق)

server.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Server running on port ' + PORT); // تشخيص
});
