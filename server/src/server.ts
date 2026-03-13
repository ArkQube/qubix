// Arkion Server - Ephemeral Real-Time Communication Platform
import express from 'express';
import { createServer } from 'http';
import https from 'https';
import { URL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import Redis from 'ioredis';
import multer from 'multer';
import { nanoid } from 'nanoid';
import cron from 'node-cron';

import {
  ServerUser,
  ServerMessage,
  ServerRoom,
  ServerFileData,
  WebSocketClientMessage,
  WS_MESSAGE_TYPES,
  EXPIRATION_TIMES,
  REDIS_KEYS,
} from './types';
import {
  generateAnonymousUsername,
  generateSessionId,
  generateRoomCode,
  generateId,
  sanitizeMessage,
  validateRoomCode,
  validatePIN,
} from './utils';

dotenv.config();

// Initialize Express app
const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

// Initialize Redis
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
});

redis.on('error', (err) => {
  console.error('Redis error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

// Initialize WebSocket server
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests explicitly
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Store connected clients
const clients = new Map<string, WebSocket>();
const users = new Map<string, ServerUser>();
const rooms = new Map<string, ServerRoom>();
const typingUsers = new Map<string, Set<string>>();
const socketUserMap = new Map<WebSocket, string>();
const globalUsers = new Set<string>();
const roomUsers = new Map<string, Set<string>>();
const messageRate = new Map<string, number[]>();

function canSendMessage(userId: string) {
  const now = Date.now();
  if (!messageRate.has(userId)) messageRate.set(userId, []);
  const timestamps = messageRate.get(userId)!;
  timestamps.push(now);
  while (timestamps.length && now - timestamps[0] > 5000) {
    timestamps.shift();
  }
  return timestamps.length < 20;
}

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

// ─── Helper: pick the correct Cloudinary resource_type ──────────────────────
//
// WHY THIS MATTERS:
//   resource_type: 'auto' lets Cloudinary decide — but for ZIPs, PDFs, and
//   other binary formats it may pick 'image' or attempt transcoding, which
//   corrupts the file.  We pick explicitly based on MIME type so:
//     - 'image'  → PNG, JPEG, GIF, WEBP, SVG …
//     - 'video'  → MP4, MOV, WEBM, audio files (Cloudinary groups audio here)
//     - 'raw'    → everything else (ZIP, PDF, DOCX, APK …) — stored as-is
//
function getCloudinaryResourceType(
  mimeType: string,
): 'image' | 'video' | 'raw' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video';
  return 'raw'; // ZIP, PDF, DOCX, XLS, APK, etc. — store without processing
}

// WebSocket message handlers
interface WSMessageHandler {
  (ws: WebSocket, userId: string, payload: any): Promise<void>;
}

const messageHandlers: Map<string, WSMessageHandler> = new Map();

// Authentication handler
messageHandlers.set(WS_MESSAGE_TYPES.AUTH, async (ws, _, payload) => {
  const { sessionId, username } = payload;

  let user: ServerUser | undefined;
  let userId: string;

  // ─── 1. Session Recovery: Reuse existing identity if sessionId match ───────
  if (sessionId) {
    for (const u of users.values()) {
      if (u.sessionId === sessionId) {
        user = u;
        userId = u.id;
        break;
      }
    }
  }

  if (user) {
    userId = user.id;
    // ─── 2. Deduplication: Sever old socket if user is re-connecting ─────────
    const oldWs = clients.get(userId);
    if (oldWs && oldWs !== ws && oldWs.readyState === WebSocket.OPEN) {
      console.log(`[AUTH] Superseding old socket for user ${user.username}`);
      oldWs.close();
    }
    
    // Allow name changes on reconnect
    if (username && username !== user.username) {
      user.username = username;
    }
  } else {
    // ─── 3. New Identity Initialization ─────────────────────────────────────
    userId = generateId();
    const newSessionId = sessionId || generateSessionId();
    const newUsername = username || generateAnonymousUsername();

    user = {
      id: userId,
      username: newUsername,
      sessionId: newSessionId,
      socketId: userId,
      joinedAt: Date.now(),
    };
    users.set(userId, user);
  }

  clients.set(userId, ws);
  socketUserMap.set(ws, userId);
  globalUsers.add(userId);

  await redis.setex(
    REDIS_KEYS.user(userId),
    EXPIRATION_TIMES.user,
    JSON.stringify(user)
  );

  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.AUTH_SUCCESS,
    payload: {
      user: {
        id: userId,
        username: user.username,
        sessionId: user.sessionId,
        joinedAt: user.joinedAt,
      },
    },
  });

  // Only broadcast join if it's truly a NEW session, or if they were offline long enough
  // For now, simpler: broadcast if a new user entry was created.
  if (!sessionId || !users.has(userId)) {
    broadcastToAll({
      type: WS_MESSAGE_TYPES.USER_JOINED,
      payload: {
        user: { id: userId, username: user.username },
        message: {
          id: generateId(),
          content: `${user.username} joined the chat`,
          type: 'system',
          timestamp: Date.now(),
          roomId: 'global',
        },
      },
    });
  }

  const globalMessages = await getGlobalMessages();
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.MESSAGE_HISTORY,
    payload: { messages: globalMessages, roomId: 'global' },
  });

  console.log(`User authenticated: ${user.username} (${userId}) ${sessionId ? '[RECOVERY]' : '[NEW]'}`);
});

// Send message handler
messageHandlers.set(WS_MESSAGE_TYPES.SEND_MESSAGE, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) {
    sendError(ws, 'User not authenticated');
    return;
  }

  if (!canSendMessage(userId)) {
    sendError(ws, 'Rate limit exceeded');
    return;
  }

  const { content, roomId, type = 'text', fileData } = payload;
  const sanitizedContent = sanitizeMessage(content || '');

  if (sanitizedContent.length > 5000) {
    sendError(ws, 'Message too long');
    return;
  }

  if (!sanitizedContent && !fileData) {
    sendError(ws, 'Message content cannot be empty');
    return;
  }

  const messageId = generateId();
  const timestamp = Date.now();
  const expiresAt = timestamp + (roomId
    ? EXPIRATION_TIMES.roomMessage * 1000
    : EXPIRATION_TIMES.globalMessage * 1000);

  const message: ServerMessage = {
    id: messageId,
    content: sanitizedContent,
    senderId: userId,
    senderUsername: user.username,
    timestamp,
    expiresAt,
    type: type as 'text' | 'file' | 'system',
    roomId,
    fileData: fileData ? { ...fileData, ownerId: userId } : undefined,
  };

  const expirationSeconds = roomId
    ? EXPIRATION_TIMES.roomMessage
    : EXPIRATION_TIMES.globalMessage;

  await redis.setex(
    REDIS_KEYS.message(messageId),
    expirationSeconds,
    JSON.stringify(message)
  );

  if (roomId) {
    await redis.zadd(REDIS_KEYS.roomMessages(roomId), timestamp, messageId);
    await redis.expire(REDIS_KEYS.roomMessages(roomId), EXPIRATION_TIMES.roomMessage);
  } else {
    await redis.zadd(REDIS_KEYS.globalMessages(), timestamp, messageId);
    await redis.expire(REDIS_KEYS.globalMessages(), EXPIRATION_TIMES.globalMessage);
  }

  const broadcastMessage = {
    type: WS_MESSAGE_TYPES.MESSAGE_RECEIVED,
    payload: {
      message: {
        id: messageId,
        content: sanitizedContent,
        sender: { id: userId, username: user.username },
        timestamp,
        expiresAt,
        type,
        fileData: message.fileData,
        roomId: roomId || 'global',
      },
      roomId: roomId || 'global',
    },
  };

  if (roomId) {
    broadcastToRoom(roomId, broadcastMessage);
  } else {
    broadcastToAll(broadcastMessage);
  }

  console.log(`Message sent by ${user.username} in ${roomId || 'global'}`);
});

// Create room handler
messageHandlers.set(WS_MESSAGE_TYPES.CREATE_ROOM, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) { sendError(ws, 'User not authenticated'); return; }

  const { name, pin } = payload;
  const roomCode = generateRoomCode();
  const roomId = generateId();
  const timestamp = Date.now();
  const expiresAt = timestamp + EXPIRATION_TIMES.room * 1000;

  const room: ServerRoom = {
    id: roomId,
    code: roomCode,
    name: name || `Room ${roomCode}`,
    pin: pin || undefined,
    createdAt: timestamp,
    expiresAt,
    participants: new Set([userId]),
    messageCount: 0,
    creatorId: userId,
  };

  rooms.set(roomId, room);

  await redis.setex(
    REDIS_KEYS.room(roomId),
    EXPIRATION_TIMES.room,
    JSON.stringify({ ...room, participants: Array.from(room.participants) })
  );

  user.currentRoom = roomId;

  globalUsers.delete(userId);
  if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Set());
  roomUsers.get(roomId)!.add(userId);

  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.ROOM_CREATED,
    payload: {
      room: {
        id: roomId,
        code: roomCode,
        name: room.name,
        hasPin: !!pin,
        createdAt: timestamp,
        expiresAt,
      },
    },
  });

  console.log(`Room created: ${roomCode} by ${user.username}`);
});

// Join room handler
messageHandlers.set(WS_MESSAGE_TYPES.JOIN_ROOM, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) { sendError(ws, 'User not authenticated'); return; }

  const { code, pin } = payload;
  const upperCode = code.toUpperCase();

  if (!validateRoomCode(upperCode)) {
    sendError(ws, 'Invalid room code format');
    return;
  }

  let room: ServerRoom | undefined;
  for (const r of rooms.values()) {
    if (r.code === upperCode) { room = r; break; }
  }

  if (!room) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'room:*', 'COUNT', 50);
      cursor = nextCursor;
      for (const key of keys) {
        // Skip sub-keys like room:123:messages or room:123:participants
        if (key.split(':').length > 2) continue;

        const roomData = await redis.get(key);
        if (!roomData) continue;
        const parsedRoom = JSON.parse(roomData);
        if (parsedRoom.code === upperCode) {
          const newRoom: ServerRoom = {
            ...parsedRoom,
            participants: new Set(parsedRoom.participants || []),
          };
          room = newRoom;
          rooms.set(parsedRoom.id, newRoom);
          break;
        }
      }
      if (room) break;
    } while (cursor !== '0');
  }

  if (!room) { sendError(ws, 'Room not found'); return; }
  if (room.pin && room.pin !== pin) { sendError(ws, 'Invalid PIN'); return; }

  if (user.currentRoom && user.currentRoom !== room.id) {
    await leaveRoom(userId, user.currentRoom);
  }

  room.participants.add(userId);
  user.currentRoom = room.id;

  globalUsers.delete(userId);
  if (!roomUsers.has(room.id)) roomUsers.set(room.id, new Set());
  roomUsers.get(room.id)!.add(userId);

  await redis.setex(
    REDIS_KEYS.room(room.id),
    EXPIRATION_TIMES.room,
    JSON.stringify({ ...room, participants: Array.from(room.participants) })
  );

  await redis.sadd(REDIS_KEYS.roomParticipants(room.id), userId);
  await redis.expire(REDIS_KEYS.roomParticipants(room.id), EXPIRATION_TIMES.room);

  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.ROOM_JOINED,
    payload: {
      room: {
        id: room.id,
        code: room.code,
        name: room.name,
        hasPin: !!room.pin,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt,
      },
      participants: Array.from(room.participants).map(pid => {
        const p = users.get(pid);
        return p ? { id: p.id, username: p.username } : null;
      }).filter(Boolean),
    },
  });

  broadcastToRoom(room.id, {
    type: WS_MESSAGE_TYPES.USER_JOINED,
    payload: {
      user: { id: userId, username: user.username },
      message: {
        id: generateId(),
        content: `${user.username} joined the room`,
        type: 'system',
        timestamp: Date.now(),
        roomId: room.id,
      },
    },
  });

  const roomMessages = await getRoomMessages(room.id);
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.MESSAGE_HISTORY,
    payload: { messages: roomMessages, roomId: room.id },
  });

  console.log(`User ${user.username} joined room ${room.code}`);
});

// Leave room handler
messageHandlers.set(WS_MESSAGE_TYPES.LEAVE_ROOM, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user || !user.currentRoom) { sendError(ws, 'Not in a room'); return; }

  await leaveRoom(userId, user.currentRoom);
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.ROOM_LEFT,
    payload: { roomId: user.currentRoom },
  });
});

// Typing indicator handler
messageHandlers.set(WS_MESSAGE_TYPES.TYPING, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) return;

  const { isTyping, roomId } = payload;
  const targetRoomId = roomId || 'global';

  if (!typingUsers.has(targetRoomId)) typingUsers.set(targetRoomId, new Set());
  const roomTyping = typingUsers.get(targetRoomId)!;

  if (isTyping) { roomTyping.add(user.username); } else { roomTyping.delete(user.username); }

  const typingUpdate = {
    type: WS_MESSAGE_TYPES.TYPING_UPDATE,
    payload: { roomId: targetRoomId, typingUsers: Array.from(roomTyping) },
  };

  if (roomId) { broadcastToRoom(roomId, typingUpdate); } else { broadcastToAll(typingUpdate); }
});

// Delete message handler
messageHandlers.set(WS_MESSAGE_TYPES.DELETE_MESSAGE, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) { sendError(ws, 'User not authenticated'); return; }

  const { messageId } = payload;
  const messageData = await redis.get(REDIS_KEYS.message(messageId));
  if (!messageData) { sendError(ws, 'Message not found'); return; }

  const message: ServerMessage = JSON.parse(messageData);
  if (message.senderId !== userId) { sendError(ws, 'Can only delete your own messages'); return; }

  await redis.del(REDIS_KEYS.message(messageId));

  if (message.roomId) {
    await redis.zrem(REDIS_KEYS.roomMessages(message.roomId), messageId);
  } else {
    await redis.zrem(REDIS_KEYS.globalMessages(), messageId);
  }

  const deleteBroadcast = {
    type: WS_MESSAGE_TYPES.DELETE_MESSAGE,
    payload: { messageId, roomId: message.roomId || 'global' },
  };

  if (message.roomId) {
    broadcastToRoom(message.roomId, deleteBroadcast);
  } else {
    broadcastToAll(deleteBroadcast);
  }

  console.log(`Message ${messageId} deleted by ${user.username}`);
});

// Delete file handler
messageHandlers.set(WS_MESSAGE_TYPES.DELETE_FILE, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) { sendError(ws, 'User not authenticated'); return; }

  const { fileId } = payload;
  const fileData = await redis.get(REDIS_KEYS.file(fileId));
  if (!fileData) { sendError(ws, 'File not found'); return; }

  const file: ServerFileData = JSON.parse(fileData);
  if (file.ownerId !== userId) { sendError(ws, 'Can only delete your own files'); return; }

  try {
    await cloudinary.uploader.destroy(file.cloudinaryPublicId);
  } catch (err) {
    console.error('Error deleting file from Cloudinary:', err);
  }

  await redis.del(REDIS_KEYS.file(fileId));
  broadcastToAll({ type: WS_MESSAGE_TYPES.FILE_DELETED, payload: { fileId } });

  console.log(`File ${fileId} deleted by ${user.username}`);
});

// Ping handler
messageHandlers.set(WS_MESSAGE_TYPES.PING, async (ws) => {
  sendToClient(ws, { type: WS_MESSAGE_TYPES.PONG, payload: {} });
});

// ─── WebSocket helpers ────────────────────────────────────────────────────────

function sendToClient(ws: WebSocket, message: any) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws: WebSocket, error: string) {
  sendToClient(ws, { type: WS_MESSAGE_TYPES.ERROR, payload: { error } });
}

function broadcastToAll(message: any, excludeUserId?: string) {
  const messageStr = JSON.stringify(message);
  globalUsers.forEach(userId => {
    if (userId === excludeUserId) return;
    const ws = clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
}

function broadcastToRoom(roomId: string, message: any, excludeUserId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  const messageStr = JSON.stringify(message);
  room.participants.forEach(userId => {
    if (userId !== excludeUserId) {
      const ws = clients.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(messageStr);
    }
  });
}

async function leaveRoom(userId: string, roomId: string) {
  const user = users.get(userId);
  const room = rooms.get(roomId);
  if (!user || !room) return;

  room.participants.delete(userId);
  user.currentRoom = undefined;

  roomUsers.get(roomId)?.delete(userId);
  globalUsers.add(userId);

  if (room.participants.size > 0) {
    await redis.setex(
      REDIS_KEYS.room(roomId),
      EXPIRATION_TIMES.room,
      JSON.stringify({ ...room, participants: Array.from(room.participants) })
    );
    await redis.srem(REDIS_KEYS.roomParticipants(roomId), userId);
    broadcastToRoom(roomId, {
      type: WS_MESSAGE_TYPES.USER_LEFT,
      payload: {
        user: { id: userId, username: user.username },
        message: {
          id: generateId(),
          content: `${user.username} left the room`,
          type: 'system',
          timestamp: Date.now(),
          roomId: roomId,
        },
      },
    });
  } else {
    rooms.delete(roomId);
    await redis.del(REDIS_KEYS.room(roomId));
    await redis.del(REDIS_KEYS.roomParticipants(roomId));
  }

  console.log(`User ${user.username} left room ${room.code}`);
}

async function getGlobalMessages(limit = 50): Promise<any[]> {
  const messageIds = await redis.zrevrange(REDIS_KEYS.globalMessages(), 0, limit - 1);
  const messages: any[] = [];
  for (const messageId of messageIds.reverse()) {
    const messageData = await redis.get(REDIS_KEYS.message(messageId));
    if (messageData) {
      const parsed = JSON.parse(messageData);
      messages.push({ ...parsed, sender: { id: parsed.senderId, username: parsed.senderUsername } });
    }
  }
  return messages;
}

async function getRoomMessages(roomId: string, limit = 50): Promise<any[]> {
  const messageIds = await redis.zrevrange(REDIS_KEYS.roomMessages(roomId), 0, limit - 1);
  const messages: any[] = [];
  for (const messageId of messageIds.reverse()) {
    const messageData = await redis.get(REDIS_KEYS.message(messageId));
    if (messageData) {
      const parsed = JSON.parse(messageData);
      messages.push({ ...parsed, sender: { id: parsed.senderId, username: parsed.senderUsername } });
    }
  }
  return messages;
}

// ─── WebSocket connection handler ─────────────────────────────────────────────

wss.on('connection', (ws: any) => {
  console.log('New WebSocket connection');

  // Mark alive on connect — the heartbeat interval will check this
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true; // Browser responded to our native ping
  });

  ws.on('message', async (data: Buffer) => {
    // Any received message also proves the socket is alive
    ws.isAlive = true;

    try {
      const message: WebSocketClientMessage = JSON.parse(data.toString());
      const { type, payload } = message;

      const userId = socketUserMap.get(ws);

      if (type === WS_MESSAGE_TYPES.AUTH) {
        const handler = messageHandlers.get(type);
        if (handler) await handler(ws, '', payload);
        return;
      }

      if (!userId || !users.has(userId)) {
        sendError(ws, 'Not authenticated');
        return;
      }

      const handler = messageHandlers.get(type);
      if (handler) {
        await handler(ws, userId, payload);
      } else {
        sendError(ws, `Unknown message type: ${type}`);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    const id = socketUserMap.get(ws);
    socketUserMap.delete(ws);

    if (id) {
      const user = users.get(id);
      if (user) {
        if (user.currentRoom) leaveRoom(id, user.currentRoom);
        broadcastToAll({
          type: WS_MESSAGE_TYPES.USER_LEFT,
          payload: {
            user: { id, username: user.username },
            message: {
              id: generateId(),
              content: `${user.username} left the chat`,
              type: 'system',
              timestamp: Date.now(),
              roomId: 'global',
            },
          },
        }, id);
        users.delete(id);
        globalUsers.delete(id);
        messageRate.delete(id);
        console.log(`User disconnected: ${user.username}`);
      }
      clients.delete(id);
    }
  });

  ws.on('error', (err: Error) => console.error('WebSocket error:', err));
});

// ─── Server-Side WS Heartbeat ───────────────────────────────────────────────────
// WHY: When mobile users open the native File Picker, iOS/Android entirely pauses
// the browser's JavaScript execution thread. The client cannot send ANY messages
// while the picker is open. Render's load balancer drops idle connections after ~60s.
//
// FIX: The server emits native RFC6455 ping frames every 25s. The browser's
// network stack responds with pong frames automatically at the OS level — this
// works even when JavaScript is completely frozen. This keeps the TCP connection
// alive through any load balancer.
//
// Additionally: sockets that fail to respond to TWO consecutive pings (50s) are
// terminated to clean up zombie connections.
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client: any) => {
    if (client.isAlive === false) {
      // This socket didn't respond to the last ping — it's dead
      return client.terminate();
    }

    // Mark as not-alive, then ping. If it responds, `pong` sets isAlive = true.
    client.isAlive = false;
    client.ping();
  });
}, 55_000); // 55s — gives mobile clients ~110s before termination (Android file picker freezes network)

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ── Download proxy ────────────────────────────────────────────────────────────
//
// FIX: There was a DUPLICATE /api/download route — Express would silently ignore
// the second one.  Now there is only ONE, clean route.
//
// This proxy is the only correct way to force a download without opening a new
// tab.  The browser's <a download> attribute is ignored for cross-origin URLs,
// so we stream the file through our own domain and set the right headers here.
//
app.get('/api/download', async (req, res) => {
  const fileUrl = req.query.url as string;
  const fileName = req.query.name as string;

  if (!fileUrl || !fileName) {
    return res.status(400).json({ error: 'Missing url or name parameters' });
  }

  // Basic SSRF guard — only proxy Cloudinary URLs
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!parsedUrl.hostname.endsWith('cloudinary.com') && !parsedUrl.hostname.endsWith('res.cloudinary.com')) {
    return res.status(403).json({ error: 'Only Cloudinary URLs are allowed' });
  }

  try {
    const response = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; Arkion/2.0)',
      },
      // Forward the real Content-Length so browsers show a progress bar
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      return res.status(response.status).json({ error: 'Upstream error' });
    }

    // Force download — no inline preview, no new tab
    // Use RFC 5987 encoding so non-ASCII filenames (Chinese, etc) survive HTTP headers
    const safeFileName = encodeURIComponent(fileName).replace(/'/g, '%27');
    // RFC 5987 encoding supports any Unicode filename (Chinese, Japanese, emoji, etc)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFileName}; filename="download"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');

    // Forward content-length so the browser can show download progress
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    // Stream directly to the client — no buffering in memory
    response.data.pipe(res);
  } catch (err: any) {
    console.error('Proxy download error:', err.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// ── File upload ───────────────────────────────────────────────────────────────

app.post('/api/upload', upload.single('file'), async (req: express.Request, res: express.Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // ── 1. IP Abuse Protection Firewall ───────────────────────────────────────
    const isBlocked = await redis.get(`block:ip:${ip}`);
    if (isBlocked) {
      console.warn(`[FIREWALL] Blocked IP ${ip} attempted to upload heavily.`);
      return res.status(429).json({ error: 'Too Many Requests: IP Temporarily Blocked' });
    }

    const uploadCount = await redis.incr(`upload:ip:${ip}`);
    if (uploadCount === 1) await redis.expire(`upload:ip:${ip}`, 60);

    if (uploadCount > 10) {
      // Hard ban for 10 minutes
      await redis.setex(`block:ip:${ip}`, 600, '1');
      console.error(`[FIREWALL] IP ${ip} exceeded upload limits. Banned for 10 minutes.`);
      return res.status(429).json({ error: 'Rate limit exceeded: IP Blocked for 10 minutes' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (req.file.size > 10 * 1024 * 1024) {
      console.warn(`[FIREWALL] IP ${ip} attempted a ${Math.round(req.file.size/1024/1024)}MB upload. Rejected.`);
      return res.status(413).json({ error: 'Payload Too Large: Exceeds 10MB limit.' });
    }

    const { sessionId, roomId } = req.body;
    if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });

    let user: ServerUser | undefined;
    for (const u of users.values()) {
      if (u.sessionId === sessionId) { user = u; break; }
    }
    if (!user) return res.status(401).json({ error: 'User not found' });

    // ── FIX: pick resource_type based on MIME type ────────────────────────────
    //
    // resource_type: 'auto' was used before.  The problem:
    //   - For images/videos: fine.
    //   - For ZIPs, PDFs, DOCXs: Cloudinary sometimes picked 'image' and
    //     attempted to transcode them — corrupting the file.
    //
    // With explicit resource_type: 'raw' for non-media files, Cloudinary stores
    // the bytes as-is, and the download proxy streams them back untouched.
    //
    const resourceType = getCloudinaryResourceType(req.file.mimetype);

    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: resourceType,
          folder: 'arkion-uploads',
          expires_at: Math.floor(Date.now() / 1000) + EXPIRATION_TIMES.file,
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
      uploadStream.end(req.file!.buffer);
    });

    const fileId = generateId();
    const timestamp = Date.now();
    const expiresAt = timestamp + EXPIRATION_TIMES.file * 1000;

    // FIX: Multer stores originalname as Latin-1 bytes, but browsers send
    // filenames as UTF-8. Re-decode to fix garbled filenames with Chinese/Japanese etc.
    // e.g. garbled "å¨åžè½½" becomes the correct "安装包"
    const fileName = Buffer.from(req.file!.originalname, 'latin1').toString('utf8');

    const fileData: ServerFileData = {
      fileId,
      fileName,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      url: result.secure_url,
      cloudinaryPublicId: result.public_id,
      ownerId: user.id,
      uploadedAt: timestamp,
      expiresAt,
    };

    await redis.setex(
      REDIS_KEYS.file(fileId),
      EXPIRATION_TIMES.file,
      JSON.stringify(fileData)
    );

    // ── 2. Storage Tracking Metrics (ZSET) ────────────────────────────────────
    const listKey = roomId ? 'files:private' : 'files:global';
    await redis.zadd(listKey, timestamp, fileId);

    res.json({
      success: true,
      file: {
        fileId,
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
        fileType: fileData.fileType,
        url: fileData.url,
        cloudinaryPublicId: fileData.cloudinaryPublicId,
        expiresAt,
      },
    });

    console.log(`File uploaded: ${fileData.fileName} (${resourceType}) by ${user.username}`);
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// API info
app.get('/api/info', (_, res) => {
  res.json({
    status: 'online',
    name: 'Arkion Server',
    version: '2.0.0',
    maxFileSize: 10 * 1024 * 1024,
    messageLifetime: EXPIRATION_TIMES.globalMessage,
    roomLifetime: EXPIRATION_TIMES.room,
    fileLifetime: EXPIRATION_TIMES.file,
    connectedUsers: users.size,
    activeRooms: rooms.size,
  });
});

// Keep-alive and Garbage Collection cron
cron.schedule('*/10 * * * *', async () => {
  try {
    // 1. Prevent infinite Redis global message queue growth
    await redis.zremrangebyscore(
      REDIS_KEYS.globalMessages(),
      '-inf',
      Date.now() - (EXPIRATION_TIMES.globalMessage * 1000)
    );

    // ── 2. Cloudinary 20GB Defensive Garbage Collector ────────────────────────
    let usage = await cloudinary.api.usage();
    // usage.storage.usage is in bytes. Check against 20GB limit.
    let usedGB = usage.storage.usage / (1024 * 1024 * 1024);

    if (usedGB > 20) {
      console.warn(`[CRITICAL] Cloudinary quota at ${usedGB.toFixed(2)}GB (>20GB limit). Triggering aggressive cull.`);

      const passes = [
        { key: 'files:global', cutoff: Date.now() - (30 * 60 * 1000) },  // Global > 30m
        { key: 'files:global', cutoff: Date.now() - (15 * 60 * 1000) },  // Global > 15m
        { key: 'files:private', cutoff: Date.now() - (60 * 60 * 1000) }  // Private > 60m
      ];

      for (const pass of passes) {
        if (usedGB <= 20) {
          console.log(`[CRON] Garbage collector successfully reduced quota below 20GB.`);
          break;
        }

        const oldFiles = await redis.zrangebyscore(pass.key, 0, pass.cutoff) as string[];
        if (oldFiles.length === 0) continue;

        console.log(`[CRON] Deleting ${oldFiles.length} files from ${pass.key}...`);

        for (const fileId of oldFiles) {
          const fileStr = await redis.get(REDIS_KEYS.file(fileId));
          if (fileStr) {
            const fileData = JSON.parse(fileStr);
            try {
              await cloudinary.uploader.destroy(fileData.cloudinaryPublicId);
            } catch (destroyErr) {
              console.error(`[CRON] Cloudinary destroy failed for ${fileId}`);
            }
            await redis.del(REDIS_KEYS.file(fileId));

            // Broadcast deletion to remove from UI visually
            broadcastToAll({
              type: WS_MESSAGE_TYPES.FILE_DELETED,
              payload: { messageId: fileId }
            });
          }
          await redis.zrem(pass.key, fileId);
        }

        // Re-check API usage explicitly after tier purge
        usage = await cloudinary.api.usage();
        usedGB = usage.storage.usage / (1024 * 1024 * 1024);
      }
    }

    // Ping Render edge node to keep free tier awake
    await axios.get('https://qubix-rr27.onrender.com/api/info');
    console.log('[CRON] Cleaned Redis queues, audited storage, and pinged self successfully.');
  } catch (err: any) {
    console.error('[CRON] Task failed:', err.message);
  }
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Arkion Server running on port ${PORT}`);
  console.log(`WebSocket server ready at /ws`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  clearInterval(heartbeatInterval);
  wss.clients.forEach(ws => ws.close());
  await redis.quit();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default server;