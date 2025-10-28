// ═══════════════════════════════════════════════════════════════
// Cold Room V2 - Server.js (Part 1/4)
// ═══════════════════════════════════════════════════════════════

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
    console.log('✅ Owner created: COLDKING / ColdKing@2025');
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
    console.log('✅ Global room created');
  }
}

createOwner();
createGlobalRoom();

// ═══════════════════════════════════════════════════════════════
// هنا ينتهي الجزء 1
// الجزء 2 سيحتوي على: login / register / send-message / edit-message / send-image / send-video
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// Cold Room V2 - Server.js (Part 2/4)
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log('🔗 New connection:', socket.id);
  socket.userIP = socket.handshake.address;

  // ───────────────────────────────────────────────
  // LOGIN
  // ───────────────────────────────────────────────
  socket.on('login', (data) => {
    try {
      const { username, password } = data;
      let userFound, userId;

      for (const [id, user] of users.entries()) {
        if (user.username.toLowerCase() === username.toLowerCase() &&
            bcrypt.compareSync(password, user.password)) {
          userFound = user;
          userId = id;
          break;
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

  // ───────────────────────────────────────────────
  // REGISTER
  // ───────────────────────────────────────────────
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

  // ───────────────────────────────────────────────
  // SEND MESSAGE
  // ───────────────────────────────────────────────
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

  // ───────────────────────────────────────────────
  // EDIT MESSAGE (متاح للجميع على رسائلهم)
  // ───────────────────────────────────────────────
  socket.on('edit-message', (data) => {
    try {
      const room = rooms.get(socket.currentRoom);
      if (!room) return;
      const messageIndex = room.messages.findIndex(m => m.id === data.messageId && m.userId === socket.userId);
      if (messageIndex !== -1) {
        room.messages[messageIndex].text = (data.newText || '').substring(0, 500);
        room.messages[messageIndex].edited = true;
        io.to(socket.currentRoom).emit('message-edited', {
          messageId: data.messageId,
          newText: room.messages[messageIndex].text
        });
        saveData();
      }
    } catch (e) { console.error(e); }
  });

  // ───────────────────────────────────────────────
  // SEND IMAGE (Owner Only)
  // ───────────────────────────────────────────────
  socket.on('send-image', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.canSendImages) return socket.emit('error', 'No permission');
      const room = rooms.get(socket.currentRoom);
      if (!room) return;

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        imageUrl: data.imageUrl,
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: true,
        roomId: socket.currentRoom,
        isImage: true,
        isVideo: false
      };

      room.messages.push(message);
      if (room.messages.length > 200) room.messages = room.messages.slice(-200);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) { console.error(e); }
  });

  // ───────────────────────────────────────────────
  // SEND VIDEO (Owner Only)
  // ───────────────────────────────────────────────
  socket.on('send-video', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.canSendVideos) return socket.emit('error', 'No permission');
      const room = rooms.get(socket.currentRoom);
      if (!room) return;

      const message = {
        id: 'msg_' + uuidv4(),
        userId: socket.userId,
        username: user.displayName,
        avatar: user.avatar,
        videoUrl: data.videoUrl,
        timestamp: new Date().toLocaleTimeString(),
        date: new Date().toISOString(),
        isOwner: true,
        roomId: socket.currentRoom,
        isImage: false,
        isVideo: true
      };

      room.messages.push(message);
      if (room.messages.length > 200) room.messages = room.messages.slice(-200);
      io.to(socket.currentRoom).emit('new-message', message);
      saveData();
    } catch (e) { console.error(e); }
  });

// ═══════════════════════════════════════════════════════════════
// هنا ينتهي الجزء 2
// الجزء 3 سيحتوي على: إدارة الغرف + الإشراف + الرسائل الخاصة
// ═══════════════════════════════════════════════════════════════
      // استمرارية من النهاية السابقة داخل io.on('connection')

      // حفظ ورسائل المرسل والمستقبل مكتملة أعلاه
      // الآن نرسل الإشعار للمستلم (إن كان متصل)
      const receiverSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === data.toUserId);
      if (receiverSocket) {
        receiverSocket.emit('new-private-message', message);
      }

      // نؤكد للاطراف المرسلة
      socket.emit('private-message-sent', message);
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  // استرجاع المحادثات الخاصة مع مستخدم محدد
  socket.on('get-private-messages', (data) => {
    try {
      const messages = privateMessages.get(socket.userId)?.[data.withUserId] || [];
      socket.emit('private-messages-list', { withUserId: data.withUserId, messages: messages.slice(-50) });
    } catch (e) {
      console.error(e);
    }
  });

  // ───────────────────────────────────────────────
  // SUPPORT MESSAGES (إرسال واسترجاع وحذف من لوحة المالك)
  // ───────────────────────────────────────────────
  socket.on('send-support-message', (data) => {
    try {
      const id = 'support_' + uuidv4();
      supportMessages.set(id, {
        id,
        from: data.from || 'Anonymous',
        message: (data.message || '').substring(0, 500),
        sentAt: new Date().toISOString(),
        fromIP: socket.userIP || ''
      });
      socket.emit('support-message-sent', { message: 'Message sent' });
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-support-messages', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      const list = Array.from(supportMessages.values());
      socket.emit('support-messages-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('delete-support-message', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      supportMessages.delete(data.messageId);
      socket.emit('action-success', 'Message deleted');
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  // ───────────────────────────────────────────────
  // LISTS: غرف و مستخدمين و مخفوقات الميوت والباند
  // ───────────────────────────────────────────────
  socket.on('get-rooms', () => {
    try {
      const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        name: room.name,
        description: room.description,
        userCount: room.users.length,
        hasPassword: !!room.hasPassword,
        isOfficial: !!room.isOfficial,
        createdBy: room.createdBy
      })).sort((a, b) => {
        if (a.isOfficial) return -1;
        if (b.isOfficial) return 1;
        return b.userCount - a.userCount;
      });
      socket.emit('rooms-list', roomList);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-users', (data) => {
    try {
      const room = rooms.get(data.roomId);
      if (!room) return socket.emit('users-list', []);
      const list = room.users.map(uid => {
        const u = users.get(uid);
        if (!u) return null;
        return {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatar: u.avatar,
          isOnline: onlineUsers.has(u.id),
          isOwner: u.isOwner || false,
          isModerator: room.moderators.includes(u.id),
          specialBadges: u.specialBadges || []
        };
      }).filter(Boolean).filter(u => onlineUsers.has(u.id));
      socket.emit('users-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-muted-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      const list = Array.from(mutedUsers.entries()).map(([userId, info]) => {
        const targetUser = users.get(userId);
        return {
          userId,
          username: targetUser?.displayName || info.username || 'Unknown',
          ...info
        };
      });
      socket.emit('muted-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  socket.on('get-banned-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      const list = Array.from(bannedUsers.entries()).map(([userId, info]) => {
        const targetUser = users.get(userId);
        return {
          userId,
          username: targetUser?.displayName || info.username || 'Unknown',
          ...info
        };
      });
      socket.emit('banned-list', list);
    } catch (e) {
      console.error(e);
    }
  });

  // ───────────────────────────────────────────────
  // DELETE ACCOUNT (بواسطة الأونر)
  // ───────────────────────────────────────────────
  socket.on('delete-account', (data) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const target = users.get(data.userId);
      if (!target || target.isOwner) return;

      // ازالة من كل الغرف والرسائل
      rooms.forEach(room => {
        room.messages = room.messages.filter(m => m.userId !== data.userId);
        room.users = room.users.filter(u => u !== data.userId);
        room.moderators = room.moderators.filter(m => m !== data.userId);
      });

      users.delete(data.userId);
      privateMessages.delete(data.userId);
      mutedUsers.delete(data.userId);
      bannedUsers.delete(data.userId);
      // فصل اذا كان متصل
      const targetSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId === data.userId);
      if (targetSocket) {
        targetSocket.emit('account-deleted', { message: 'Account deleted' });
        targetSocket.disconnect(true);
      }

      socket.emit('action-success', `Deleted: ${data.userId}`);
      updateRoomsList();
      saveData();
    } catch (e) {
      console.error(e);
    }
  });

  // ───────────────────────────────────────────────
  // DELETE MESSAGE (بواسطة الأونر)
  // ───────────────────────────────────────────────
  socket.on('delete-message', (data) => {
    try {
      const admin = users.get(socket.userId);
      if (!admin?.isOwner) return;
      const room = rooms.get(data.roomId);
      if (!room) return;
      const idx = room.messages.findIndex(m => m.id === data.messageId);
      if (idx > -1) {
        room.messages.splice(idx, 1);
        io.to(data.roomId).emit('message-deleted', { messageId: data.messageId });
        saveData();
      }
    } catch (e) {
      console.error(e);
    }
  });

  // ───────────────────────────────────────────────
  // PING (heartbeat) و DISCONNECT
  // ───────────────────────────────────────────────
  socket.on('ping', () => {
    try { if (socket.userId) onlineUsers.set(socket.userId, Date.now()); } catch (e) { console.error(e); }
  });

  socket.on('disconnect', () => {
    try {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        // ازالة من الغرف المؤقتة (غير الرسمية)
        rooms.forEach(room => {
          if (!room.isOfficial) room.users = room.users.filter(u => u !== socket.userId);
        });
      }
      console.log('🔌 Disconnect:', socket.id);
    } catch (e) {
      console.error(e);
    }
  });

  // نهاية التتمة لجزء 3 داخل io.on('connection')
// ═══════════════════════════════════════════════════════════════
// Cold Room V2 - Server.js (Part 4/4)
// ═══════════════════════════════════════════════════════════════

// ملاحظة: هذا الجزء يفترض أن كتلة io.on('connection') قد انتهت كما في الجزء 3.
// الآن دوال إعدادات السيتينج والتحكم باليوتيوب والـ party mode، والمتفرقات.

// ───────────────────────────────────────────────
// SETTINGS UPDATE (من لوحة الأونر)
// ───────────────────────────────────────────────
io.on('connection', (socket) => {
  // تحديث الإعدادات العامة (يستدعى من لوحة الأونر)
  socket.on('update-settings', (payload) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      // قبول حقول محددة فقط
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
      console.error(e);
    }
  });

  // OWNER requests lists (support/muted/banned)
  socket.on('get-support-messages', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      socket.emit('support-messages-list', Array.from(supportMessages.values()));
    } catch (e) { console.error(e); }
  });

  socket.on('get-muted-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      const list = Array.from(mutedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info }));
      socket.emit('muted-list', list);
    } catch (e) { console.error(e); }
  });

  socket.on('get-banned-list', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return;
      socket.emit('banned-list', Array.from(bannedUsers.entries()).map(([uid, info]) => ({ userId: uid, ...info })));
    } catch (e) { console.error(e); }
  });
});

// ───────────────────────────────────────────────
// PARTY MODE (تفعيل / تعطيل) بمزامنة للجميع
// ───────────────────────────────────────────────
function setPartyMode(roomId, enabled) {
  systemSettings.partyMode = systemSettings.partyMode || {};
  systemSettings.partyMode[roomId] = !!enabled;
  io.to(roomId).emit('party-mode-changed', { enabled: !!enabled, roomId });
  saveData();
}

// تطبيق أوامر Party من داخل كتلة io.on('connection') تم تعريفها سابقًا (مثال في client يستخدم 'toggle-party-mode')
// لكن لضمان وجود معالجة عامة، نسمح للأونر/المود أن يرسلوا:
io.on('connection', (socket) => {
  socket.on('toggle-party-mode', (data) => {
    try {
      const user = users.get(socket.userId);
      const room = rooms.get(data.roomId || socket.currentRoom);
      if (!user || !room) return;
      // المالك يمكنه دائمًا، المشرفون يمكنهم أيضًا
      const allowed = user.isOwner || room.moderators.includes(socket.userId);
      if (!allowed) return socket.emit('error', 'No permission');
      const enabled = !!data.enabled;
      setPartyMode(room.id, enabled);
    } catch (e) { console.error(e); }
  });
});

// ───────────────────────────────────────────────
// YOUTUBE WATCH TOGETHER (Owner control + sync)
// ───────────────────────────────────────────────
/*
systemSettings.youtube = {
  videoId: 'string',
  startedAt: Number (Date.now()),
  size: 'small'|'medium'|'large',
  startedBy: 'DisplayName'
}
*/

// بدء مشاهدة يوتيوب (المالك فقط)
io.on('connection', (socket) => {
  socket.on('start-youtube-watch', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (!data || !data.videoId) return socket.emit('error', 'No videoId');

      systemSettings.youtube = {
        videoId: data.videoId,
        startedAt: Date.now(),
        size: data.size || 'medium',
        startedBy: user.displayName
      };

      io.to('global_cold').emit('youtube-started', systemSettings.youtube);
      saveData();
    } catch (e) { console.error(e); }
  });

  socket.on('stop-youtube-watch', () => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      systemSettings.youtube = null;
      io.to('global_cold').emit('youtube-stopped');
      saveData();
    } catch (e) { console.error(e); }
  });

  socket.on('youtube-resize', (data) => {
    try {
      const user = users.get(socket.userId);
      if (!user?.isOwner) return socket.emit('error', 'No permission');
      if (!systemSettings.youtube) return;
      systemSettings.youtube.size = data.size || systemSettings.youtube.size || 'medium';
      io.to('global_cold').emit('youtube-resize', { size: systemSettings.youtube.size });
      saveData();
    } catch (e) { console.error(e); }
  });

  // عند طلب العميل للحصول على الحالة الحالية
  socket.on('get-youtube-state', () => {
    try {
      socket.emit('youtube-state', systemSettings.youtube || null);
    } catch (e) { console.error(e); }
  });
});

// ───────────────────────────────────────────────
// HELPER FUNCTIONS (تحديث القوائم وإرسال الأحداث العامة)
// ───────────────────────────────────────────────
function updateRoomsList() {
  try {
    const roomsArray = Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdBy: r.createdBy,
      userCount: r.users.length,
      hasPassword: !!r.hasPassword,
      isOfficial: !!r.isOfficial
    }));
    io.emit('rooms-list', roomsArray);
  } catch (e) { console.error(e); }
}

function updateUsersList(roomId) {
  try {
    const room = rooms.get(roomId);
    if (!room) return;
    const usersArray = room.users.map(uid => {
      const u = users.get(uid);
      if (!u) return null;
      return {
        id: u.id,
        displayName: u.displayName,
        avatar: u.avatar,
        isOwner: u.isOwner || false,
        isModerator: room.moderators.includes(u.id),
        isOnline: onlineUsers.has(u.id)
      };
    }).filter(Boolean);
    io.to(roomId).emit('users-list', usersArray);
  } catch (e) { console.error(e); }
}

// دالة لتنظيف كل البيانات (فقط في حال أردت إعادة تهيئة dev)
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
  createOwner();
  createGlobalRoom();
  saveData();
}

// ───────────────────────────────────────────────
// AUTO-SAVE PERIODIC
// ───────────────────────────────────────────────
setInterval(() => {
  try { saveData(); } catch (e) { console.error(e); }
}, 30000);

// ───────────────────────────────────────────────
// START SERVER
// ───────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`🚀 Cold Room server running on port ${PORT}`);
});
```
