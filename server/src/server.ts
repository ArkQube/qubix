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

  // Only broadcast join if it's truly a NEW identity (not a session recovery)
  if (!sessionId) {
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

  if (sanitizedContent.length > 50000) {
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

  const roomId = user.currentRoom; // Save before leaveRoom() clears it
  await leaveRoom(userId, roomId);
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.ROOM_LEFT,
    payload: { roomId },
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

// Suspend handler — client signals it's opening the file picker (Android freezes JS)
messageHandlers.set(WS_MESSAGE_TYPES.SUSPEND, async (ws: any) => {
  ws.suspended = true;
  console.log('[WS] Client suspended (file picker open)');
});

// Resume handler — client signals the file picker closed
messageHandlers.set(WS_MESSAGE_TYPES.RESUME, async (ws: any) => {
  ws.suspended = false;
  ws.isAlive = true;
  console.log('[WS] Client resumed (file picker closed)');
});

// Reaction handlers
messageHandlers.set(WS_MESSAGE_TYPES.ADD_REACTION, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) return;

  const { messageId, emoji } = payload;
  const messageData = await redis.get(REDIS_KEYS.message(messageId));
  if (!messageData) return;

  const message: ServerMessage = JSON.parse(messageData);
  if (!message.reactions) message.reactions = {};
  if (!message.reactions[emoji]) message.reactions[emoji] = [];
  
  if (!message.reactions[emoji].includes(user.username)) {
    message.reactions[emoji].push(user.username);
  }

  await redis.setex(
    REDIS_KEYS.message(messageId),
    Math.max(1, Math.floor((message.expiresAt - Date.now()) / 1000)),
    JSON.stringify(message)
  );

  const update = {
    type: WS_MESSAGE_TYPES.REACTION_UPDATE,
    payload: { messageId, reactions: message.reactions, roomId: message.roomId || 'global' }
  };

  if (message.roomId) {
    broadcastToRoom(message.roomId, update);
  } else {
    broadcastToAll(update);
  }
});

messageHandlers.set(WS_MESSAGE_TYPES.REMOVE_REACTION, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) return;

  const { messageId, emoji } = payload;
  const messageData = await redis.get(REDIS_KEYS.message(messageId));
  if (!messageData) return;

  const message: ServerMessage = JSON.parse(messageData);
  if (!message.reactions || !message.reactions[emoji]) return;
  
  message.reactions[emoji] = message.reactions[emoji].filter(name => name !== user.username);
  if (message.reactions[emoji].length === 0) {
    delete message.reactions[emoji];
  }

  await redis.setex(
    REDIS_KEYS.message(messageId),
    Math.max(1, Math.floor((message.expiresAt - Date.now()) / 1000)),
    JSON.stringify(message)
  );

  const update = {
    type: WS_MESSAGE_TYPES.REACTION_UPDATE,
    payload: { messageId, reactions: message.reactions, roomId: message.roomId || 'global' }
  };

  if (message.roomId) {
    broadcastToRoom(message.roomId, update);
  } else {
    broadcastToAll(update);
  }
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
  ws.suspended = false;

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
      clients.delete(id);

      if (user) {
        // ─── GRACE PERIOD: Keep user in memory for session recovery ─────────
        // On Android, opening the file picker kills the TCP socket. The client
        // will reconnect in ~3 seconds and attempt session recovery via
        // sessionId. If we delete the user NOW, the AUTH handler can't find
        // them and they lose their identity, messages, and room membership.
        //
        // Instead: remove from active tracking, but keep the user object alive
        // for 2 minutes. If they reconnect within that window, the AUTH
        // handler reuses their identity seamlessly. If they don't, this
        // timer cleans them up.
        globalUsers.delete(id);

        const _gracePeriod = setTimeout(() => {
          // If the user reconnected, clients.has(id) will be true again
          if (clients.has(id)) return; // They came back — do nothing

          // They didn't come back — full cleanup
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
          messageRate.delete(id);
          console.log(`User cleaned up after grace period: ${user.username}`);
        }, 120_000); // 2 minutes grace

        // If they reconnect via AUTH, the old timer is harmless (clients.has check)
        console.log(`Socket closed for ${user.username} — 2min grace period started`);
      }
    }
  });

  ws.on('error', (err: Error) => console.error('WebSocket error:', err));
});

// ─── Server-Side WS Heartbeat ───────────────────────────────────────────────────
// WHY: When mobile users open the native File Picker, iOS/Android entirely pauses
// the browser's JavaScript execution thread. The client cannot send ANY messages
// while the picker is open. Render's load balancer drops idle connections after
// approximately 30–60s of no WebSocket frames.
//
// FIX: The server emits native RFC6455 ping frames every 20s. The browser's
// network stack responds with pong frames automatically at the OS level — this
// works even when JavaScript is completely frozen. This keeps the TCP connection
// alive through any load balancer.
//
// Termination: sockets that miss THREE consecutive pings (60s total) are killed
// to clean up genuine zombie connections.
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((client: any) => {
    // Skip suspended clients — they have the file picker open (Android freezes JS)
    if (client.suspended) return;

    if (client.isAlive === false) {
      client.missedPings = (client.missedPings || 0) + 1;
      if (client.missedPings >= 3) {
        // Dead for 90s+ — terminate
        return client.terminate();
      }
    } else {
      client.missedPings = 0;
    }

    // Mark as not-alive, then ping. If it responds, `pong` sets isAlive = true.
    client.isAlive = false;
    client.ping();
  });
}, 30_000); // 30s interval × 3 missed = 90s tolerance (mobile-friendly)

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
    // ── FIX: Generate a SIGNED URL for raw resources ──────────────────────
    //
    // WHY THIS IS NEEDED:
    //   Cloudinary blocks unsigned access to `raw` resources (PDFs, ZIPs,
    //   DOCX, etc.) by default — returning 401 Unauthorized.  When we
    //   switched from resource_type:'auto' to resource_type:'raw' for
    //   non-media files (to prevent Cloudinary transcoding/corruption),
    //   their plain URLs stopped working.
    //
    //   Images and videos are fine because Cloudinary allows unsigned
    //   access to those resource types.
    //
    // FIX: Detect raw URLs by checking the path for `/raw/upload/`.
    //   Extract the public ID and use the Cloudinary SDK to generate a
    //   time-limited signed URL that bypasses the restriction.
    //
    let downloadUrl = fileUrl;

    const isRawResource = parsedUrl.pathname.includes('/raw/upload/');
    if (isRawResource) {
      // Extract public ID from URL path:
      //   /raw/upload/v1234567890/arkion-uploads/abc123.pdf
      //   → arkion-uploads/abc123.pdf
      const rawUploadMatch = parsedUrl.pathname.match(/\/raw\/upload\/(?:v\d+\/)?(.+)$/);
      if (rawUploadMatch) {
        const publicId = decodeURIComponent(rawUploadMatch[1]);
        // Generate a signed URL valid for 1 hour
        downloadUrl = cloudinary.url(publicId, {
          resource_type: 'raw',
          type: 'upload',
          sign_url: true,
          secure: true,
        });
        console.log(`[Download Proxy] Signed raw URL for: ${publicId}`);
      }
    }

    // ── Stream the file using Node's native https ─────────────────────────
    const fetchStream = (targetUrl: string, redirectCount = 0): void => {
      if (redirectCount > 5) {
        return void res.status(502).json({ error: 'Too many redirects' });
      }

      const getter = targetUrl.startsWith('https') ? https.get : require('http').get;

      getter(targetUrl, {
        headers: {
          'Accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; Arkion/2.0)',
        },
      }, (upstream: any) => {
        // Handle redirects manually (301, 302, 307, 308)
        if ([301, 302, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
          upstream.resume(); // Drain the response to free the socket
          return fetchStream(upstream.headers.location, redirectCount + 1);
        }

        if (upstream.statusCode !== 200) {
          console.error(`[Download Proxy] Upstream returned ${upstream.statusCode} for ${targetUrl}`);
          upstream.resume();
          return void res.status(upstream.statusCode || 502).json({
            error: `Upstream error (${upstream.statusCode})`,
          });
        }

        // Force download — no inline preview, no new tab
        const safeFileName = encodeURIComponent(fileName).replace(/'/g, '%27');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFileName}; filename="download"`);
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');

        // Forward content-length so the browser can show download progress
        if (upstream.headers['content-length']) {
          res.setHeader('Content-Length', upstream.headers['content-length']);
        }

        // Stream directly to the client — no buffering in memory
        upstream.pipe(res);

        upstream.on('error', (err: Error) => {
          console.error('[Download Proxy] Stream error:', err.message);
          if (!res.headersSent) {
            res.status(502).json({ error: 'Stream interrupted' });
          } else {
            res.end();
          }
        });
      }).on('error', (err: Error) => {
        console.error('[Download Proxy] Connection error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Failed to connect to upstream' });
        }
      });
    };

    fetchStream(downloadUrl);
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
          // access_mode:'public' is required for raw resources (PDFs, ZIPs, etc.)
          // Without it, Cloudinary defaults to 'authenticated' delivery for raw
          // assets, meaning the URL returns 401 unless a signed URL is used.
          // Images and videos are public by default; raw files are not.
          access_mode: 'public',
          folder: 'arkion-uploads',
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

// ─── Direct Cloudinary Upload: Signature endpoint ─────────────────────────────
// Client calls this to get signed Cloudinary params, then uploads directly
// to Cloudinary — eliminates the double-hop through our server.
app.post('/api/upload/sign', async (req: express.Request, res: express.Response) => {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // ── IP Abuse Protection (same as /api/upload) ──
    const isBlocked = await redis.get(`block:ip:${ip}`);
    if (isBlocked) {
      return res.status(429).json({ error: 'Too Many Requests: IP Temporarily Blocked' });
    }

    const uploadCount = await redis.incr(`upload:ip:${ip}`);
    if (uploadCount === 1) await redis.expire(`upload:ip:${ip}`, 60);
    if (uploadCount > 10) {
      await redis.setex(`block:ip:${ip}`, 600, '1');
      return res.status(429).json({ error: 'Rate limit exceeded: IP Blocked for 10 minutes' });
    }

    const { sessionId } = req.body;
    if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });

    let user: ServerUser | undefined;
    for (const u of users.values()) {
      if (u.sessionId === sessionId) { user = u; break; }
    }
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Generate Cloudinary signature
    // IMPORTANT: access_mode must be signed so raw files are publicly accessible.
    // Without signing access_mode:'public', Cloudinary ignores it for raw resources
    // and defaults to 'authenticated', causing 401 on download.
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'arkion-uploads';
    const paramsToSign = {
      timestamp,
      folder,
      access_mode: 'public',
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET || ''
    );

    res.json({
      signature,
      timestamp,
      folder,
      access_mode: 'public',
      apiKey: process.env.CLOUDINARY_API_KEY || '',
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    });

    console.log(`[UPLOAD/SIGN] Signature generated for ${user.username}`);
  } catch (err) {
    console.error('Upload sign error:', err);
    res.status(500).json({ error: 'Failed to generate upload signature' });
  }
});

// ─── Direct Cloudinary Upload: Confirm endpoint ───────────────────────────────
// After the client uploads directly to Cloudinary, it calls this to register
// the file metadata in Redis for deletion tracking, CRON cleanup, etc.
app.post('/api/upload/confirm', async (req: express.Request, res: express.Response) => {
  try {
    const { sessionId, roomId, fileId, fileName, fileSize, fileType, url, cloudinaryPublicId } = req.body;

    if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });
    if (!fileId || !url || !cloudinaryPublicId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let user: ServerUser | undefined;
    for (const u of users.values()) {
      if (u.sessionId === sessionId) { user = u; break; }
    }
    if (!user) return res.status(401).json({ error: 'User not found' });

    const timestamp = Date.now();
    const expiresAt = timestamp + EXPIRATION_TIMES.file * 1000;

    const fileData: ServerFileData = {
      fileId,
      fileName: fileName || 'unknown',
      fileSize: fileSize || 0,
      fileType: fileType || 'application/octet-stream',
      url,
      cloudinaryPublicId,
      ownerId: user.id,
      uploadedAt: timestamp,
      expiresAt,
    };

    await redis.setex(
      REDIS_KEYS.file(fileId),
      EXPIRATION_TIMES.file,
      JSON.stringify(fileData)
    );

    // Storage tracking for CRON garbage collector
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
        ownerId: user.id,
        expiresAt,
      },
    });

    console.log(`[UPLOAD/CONFIRM] File ${fileName} registered by ${user.username}`);
  } catch (err) {
    console.error('Upload confirm error:', err);
    res.status(500).json({ error: 'Failed to confirm upload' });
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