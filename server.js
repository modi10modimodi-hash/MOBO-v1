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

// Public endpoint for early settings (login page color/music)
app.get('/settings', (req, res) => {
  try {
    res.json(systemSettings);
  } catch (e) {
    res.status(500).json({ error: 'settings_unavailable' });
  }
});

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
    partyMode: {},
    youtube: null // { videoId, startedAt, size }
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
/* CLEANUP TASKS */
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
/* SOCKET.IO CONNECTION */
// ═══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  socket.userIP = socket.handshake.address;

  // LOGIN
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
        systemSettings: systemSettings,
        youtube: systemSettings.youtube // for sync on login
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

  // REGISTER
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

      if (displayName.length < 3 || displayName.length > 30) {
        return socket.emit('register-error', 'Display name: 3-30 characters');
      }

      // Ensure unique username and unique display name across platform
      for (const user of users.values()) {
        if (user.username.toLowerCase() === username.toLowerCase()) {
          return socket.emit('register-error', 'Username exists');
        }
        if (user.displayName.toLowerCase() === displayName.toLowerCase()) {
          return socket.emit('register-error', 'Display name exists');
        }
      }

      const userId = 'user_' + uuidv4();
      const hashedPassword = bcrypt.hashSync(password, 10);

      const newUser = {
        id: userId,
        username: username,
        displayName: displayName,
        password: hashedPassword,
        isOwner: false,
        joinDate: new Date().toISOString(),
        avatar: gender === 'prince' ? '🤴' : gender === 'princess' ? '👸' : '👤',
        gender: gender,
        specialBadges: [],
        canSendImages: false,
        canSendVideos: false
      };

      users.set(userId, newUser);
      privateMessages.set(userId, {});

      socket.emit('register-success', {
        message: 'Account created!',
        username: username
      });

      saveData();

    } catch (error) {
      console.error('❌ Register error:', error);
      socket.emit('register-error', 'Registration failed');
    }
  });

  // SEND MESSAGE
  socket.on('send-message', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !socket.currentRoom) return;

      const room = rooms.get(socket.currentRoom);
      if (!room) return;

      if (room.isSilenced && !user.isOwner) {
        return socket.emit('message-error', 'Room is silenced');
      }

      const muteInfo = mutedUsers.get(socket.userId);
      if (muteInfo) {
        const canUnmute = !muteInfo.byOwner && muteInfo.temporary && muteInfo.expires && muteInfo.expires <= Date.now();
        if (!canUnmute) {
          return socket.emit('message-error', 'You are muted');
        } else {
          mutedUsers.delete(socket.userId);
        }
      }

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        text: (data.text || '').trim().substring(0, 500),
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toISOString(),
        isOwner: user.isOwner || false,
        isModerator: room.moderators.includes(socket.userId),
        specialBadges: user.specialBadges || [],
        roomId: socket.currentRoom,
        edited: false,
        isImage: false,
        isVideo: false
      };

      room.messages.push(message);
      if (room.messages.length > 200) {
        room.messages = room.messages.slice(-200);
      }

      io.to(socket.currentRoom).emit('new-message', message);
      onlineUsers.set(socket.userId, Date.now());
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Message error:', error);
      socket.emit('message-error', 'Failed to send');
    }
  });

  // EDIT MESSAGE: allow the sender (not only owner)
  socket.on('edit-message', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;
      const room = rooms.get(socket.currentRoom);
      if (!room) return;

      const messageIndex = room.messages.findIndex(m => m.id === data.messageId && m.userId === socket.userId);
      if (messageIndex !== -1) {
        room.messages[messageIndex].text = (data.newText || '').trim().substring(0, 500);
        room.messages[messageIndex].edited = true;
        io.to(socket.currentRoom).emit('message-edited', {
          messageId: data.messageId,
          newText: room.messages[messageIndex].text
        });
        setTimeout(() => saveData(), 100);
      }

    } catch (error) {
      console.error('❌ Edit error:', error);
    }
  });

  // SEND IMAGE (Owner Only)
  socket.on('send-image', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.canSendImages) {
        return socket.emit('error', 'No permission');
      }
      const room = rooms.get(socket.currentRoom);
      if (!room) return;

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        imageUrl: data.imageUrl,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toISOString(),
        isOwner: true,
        specialBadges: user.specialBadges || [],
        roomId: socket.currentRoom,
        isImage: true,
        isVideo: false
      };

      room.messages.push(message);
      if (room.messages.length > 200) room.messages = room.messages.slice(-200);
      io.to(socket.currentRoom).emit('new-message', message);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Image error:', error);
    }
  });

  // SEND VIDEO (Owner Only)
  socket.on('send-video', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user || !user.canSendVideos) {
        return socket.emit('error', 'No permission');
      }
      const room = rooms.get(socket.currentRoom);
      if (!room) return;

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        videoUrl: data.videoUrl,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toISOString(),
        isOwner: true,
        specialBadges: user.specialBadges || [],
        roomId: socket.currentRoom,
        isImage: false,
        isVideo: true
      };

      room.messages.push(message);
      if (room.messages.length > 200) room.messages = room.messages.slice(-200);
      io.to(socket.currentRoom).emit('new-message', message);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Video error:', error);
    }
  });

  // CHANGE DISPLAY NAME (unique for all users)
  socket.on('change-display-name', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;

      const newName = (data.newName || '').trim().substring(0, 30);
      if (!newName || newName.length < 3) {
        return socket.emit('error', 'Invalid name');
      }

      // enforce uniqueness
      for (const u of users.values()) {
        if (u.displayName.toLowerCase() === newName.toLowerCase()) {
          return socket.emit('error', 'Display name exists');
        }
      }

      user.displayName = newName;
      socket.emit('action-success', 'Name changed');
      updateUsersList(socket.currentRoom);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Change name error:', error);
    }
  });

  // PRIVATE MESSAGES
  socket.on('send-private-message', async (data) => {
    try {
      const sender = users.get(socket.userId);
      const receiver = users.get(data.toUserId);
      if (!sender || !receiver) return;

      const message = {
        id: 'pm_' + uuidv4(),
        from: socket.userId,
        to: data.toUserId,
        fromName: sender.displayName,
        text: (data.text || '').trim().substring(0, 500),
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        date: new Date().toISOString(),
        edited: false
      };

      if (!privateMessages.has(socket.userId)) privateMessages.set(socket.userId, {});
      if (!privateMessages.get(socket.userId)[data.toUserId]) privateMessages.get(socket.userId)[data.toUserId] = [];
      privateMessages.get(socket.userId)[data.toUserId].push(message);

      if (!privateMessages.has(data.toUserId)) privateMessages.set(data.toUserId, {});
      if (!privateMessages.get(data.toUserId)[socket.userId]) privateMessages.get(data.toUserId)[socket.userId] = [];
      privateMessages.get(data.toUserId)[socket.userId].push(message);

      const receiverSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === data.toUserId);
      if (receiverSocket) receiverSocket.emit('new-private-message', message);

      socket.emit('private-message-sent', message);
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ PM error:', error);
    }
  });

  socket.on('get-private-messages', async (data) => {
    try {
      const messages = privateMessages.get(socket.userId)?.[data.withUserId] || [];
      socket.emit('private-messages-list', {
        withUserId: data.withUserId,
        messages: messages.slice(-50)
      });
    } catch (error) {
      console.error('❌ Get PM error:', error);
    }
  });

  // ROOM MANAGEMENT
  socket.on('create-room', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;

      const roomId = 'room_' + uuidv4();
      const newRoom = {
        id: roomId,
        name: (data.name || '').substring(0, 50),
        description: data.description?.substring(0, 200) || '',
        createdBy: user.displayName,
        creatorId: socket.userId,
        users: [socket.userId],
        messages: [],
        isOfficial: false,
        hasPassword: !!data.password,
        password: data.password ? bcrypt.hashSync(data.password, 10) : null,
        moderators: [],
        isSilenced: false,
        createdAt: new Date().toISOString()
      };

      rooms.set(roomId, newRoom);
      socket.emit('room-created', { roomId: roomId, roomName: newRoom.name });
      updateRoomsList();
      setTimeout(() => saveData(), 100);

    } catch (error) {
      console.error('❌ Create room error:', error);
    }
  });

  socket.on('join-room', async (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user) return;

      const room = rooms.get(data.roomId);
      if (!room) return socket.emit('error', 'Room not found');

      if (room.hasPassword && !user.isOwner) {
        if (!data.password || !bcrypt.compareSync(data.password, room.password)) {
          return socket.emit('error', 'Wrong password');
        }
      }

      if (socket.currentRoom) {
        const prevRoom = rooms.get(socket.currentRoom);
        if (prevRoom) {
          const index = prevRoom.users.indexOf(socket.userId);
          if (index > -1) prevRoom.users.splice(index, 1);
          socket.leave(socket.currentRoom);
        }
      }

      if (!room.users.includes(socket.userId)) {
       
