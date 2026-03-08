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
  // We can add origin checking here if strictly needed,
  // but for now we accept to fix Vercel CORS drops.
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

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
});

// WebSocket message handlers
interface WSMessageHandler {
  (ws: WebSocket, userId: string, payload: any): Promise<void>;
}

const messageHandlers: Map<string, WSMessageHandler> = new Map();

// Authentication handler
messageHandlers.set(WS_MESSAGE_TYPES.AUTH, async (ws, _, payload) => {
  const { sessionId, username } = payload;
  const userId = generateId();
  const newSessionId = sessionId || generateSessionId();
  const newUsername = username || generateAnonymousUsername();

  const user: ServerUser = {
    id: userId,
    username: newUsername,
    sessionId: newSessionId,
    socketId: userId,
    joinedAt: Date.now(),
  };

  users.set(userId, user);
  clients.set(userId, ws);

  // Store user in Redis with expiration
  await redis.setex(
    REDIS_KEYS.user(userId),
    EXPIRATION_TIMES.user,
    JSON.stringify(user)
  );

  // Send auth success
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.AUTH_SUCCESS,
    payload: {
      user: {
        id: userId,
        username: newUsername,
        sessionId: newSessionId,
        joinedAt: user.joinedAt,
      },
    },
  });

  // Broadcast user joined to global chat
  broadcastToAll({
    type: WS_MESSAGE_TYPES.USER_JOINED,
    payload: {
      user: {
        id: userId,
        username: newUsername,
      },
      message: {
        id: generateId(),
        content: `${newUsername} joined the chat`,
        type: 'system',
        timestamp: Date.now(),
      },
    },
  });

  // Send recent global messages
  const globalMessages = await getGlobalMessages();
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.MESSAGE_HISTORY,
    payload: {
      messages: globalMessages,
      roomId: 'global',
    },
  });

  console.log(`User authenticated: ${newUsername} (${userId})`);
});

// Send message handler
messageHandlers.set(WS_MESSAGE_TYPES.SEND_MESSAGE, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) {
    sendError(ws, 'User not authenticated');
    return;
  }

  const { content, roomId, type = 'text', fileData } = payload;
  const sanitizedContent = sanitizeMessage(content || '');

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
    fileData: fileData ? {
      ...fileData,
      ownerId: userId,
    } : undefined,
  };

  // Store message in Redis with expiration
  const expirationSeconds = roomId
    ? EXPIRATION_TIMES.roomMessage
    : EXPIRATION_TIMES.globalMessage;

  await redis.setex(
    REDIS_KEYS.message(messageId),
    expirationSeconds,
    JSON.stringify(message)
  );

  // Add to room or global message list
  if (roomId) {
    await redis.zadd(REDIS_KEYS.roomMessages(roomId), timestamp, messageId);
    await redis.expire(REDIS_KEYS.roomMessages(roomId), EXPIRATION_TIMES.roomMessage);
  } else {
    await redis.zadd(REDIS_KEYS.globalMessages(), timestamp, messageId);
    await redis.expire(REDIS_KEYS.globalMessages(), EXPIRATION_TIMES.globalMessage);
  }

  // Broadcast message
  const broadcastMessage = {
    type: WS_MESSAGE_TYPES.MESSAGE_RECEIVED,
    payload: {
      message: {
        id: messageId,
        content: sanitizedContent,
        sender: {
          id: userId,
          username: user.username,
        },
        timestamp,
        expiresAt,
        type,
        fileData: message.fileData,
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
  if (!user) {
    sendError(ws, 'User not authenticated');
    return;
  }

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

  // Store room in Redis with expiration
  await redis.setex(
    REDIS_KEYS.room(roomId),
    EXPIRATION_TIMES.room,
    JSON.stringify({
      ...room,
      participants: Array.from(room.participants),
    })
  );

  // Update user's current room
  user.currentRoom = roomId;

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
  if (!user) {
    sendError(ws, 'User not authenticated');
    return;
  }

  const { code, pin } = payload;
  const upperCode = code.toUpperCase();

  if (!validateRoomCode(upperCode)) {
    sendError(ws, 'Invalid room code format');
    return;
  }

  // Find room by code
  let room: ServerRoom | undefined;
  for (const r of rooms.values()) {
    if (r.code === upperCode) {
      room = r;
      break;
    }
  }

  if (!room) {
    // Try to get from Redis
    const roomKeys = await redis.keys('room:*');
    for (const key of roomKeys) {
      const roomData = await redis.get(key);
      if (roomData) {
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
    }
  }

  if (!room) {
    sendError(ws, 'Room not found');
    return;
  }

  // Verify PIN if room has one
  if (room.pin && room.pin !== pin) {
    sendError(ws, 'Invalid PIN');
    return;
  }

  // Leave current room if in one
  if (user.currentRoom && user.currentRoom !== room.id) {
    await leaveRoom(userId, user.currentRoom);
  }

  // Add user to room
  room.participants.add(userId);
  user.currentRoom = room.id;

  // Update room in Redis
  await redis.setex(
    REDIS_KEYS.room(room.id),
    EXPIRATION_TIMES.room,
    JSON.stringify({
      ...room,
      participants: Array.from(room.participants),
    })
  );

  // Add to room participants set
  await redis.sadd(REDIS_KEYS.roomParticipants(room.id), userId);
  await redis.expire(REDIS_KEYS.roomParticipants(room.id), EXPIRATION_TIMES.room);

  // Send room joined confirmation
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

  // Broadcast user joined to room
  broadcastToRoom(room.id, {
    type: WS_MESSAGE_TYPES.USER_JOINED,
    payload: {
      user: {
        id: userId,
        username: user.username,
      },
      message: {
        id: generateId(),
        content: `${user.username} joined the room`,
        type: 'system',
        timestamp: Date.now(),
      },
    },
  });

  // Send recent room messages
  const roomMessages = await getRoomMessages(room.id);
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.MESSAGE_HISTORY,
    payload: {
      messages: roomMessages,
      roomId: room.id,
    },
  });

  console.log(`User ${user.username} joined room ${room.code}`);
});

// Leave room handler
messageHandlers.set(WS_MESSAGE_TYPES.LEAVE_ROOM, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user || !user.currentRoom) {
    sendError(ws, 'Not in a room');
    return;
  }

  await leaveRoom(userId, user.currentRoom);

  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.ROOM_LEFT,
    payload: {
      roomId: user.currentRoom,
    },
  });
});

// Typing indicator handler
messageHandlers.set(WS_MESSAGE_TYPES.TYPING, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) return;

  const { isTyping, roomId } = payload;
  const targetRoomId = roomId || 'global';

  if (!typingUsers.has(targetRoomId)) {
    typingUsers.set(targetRoomId, new Set());
  }

  const roomTyping = typingUsers.get(targetRoomId)!;

  if (isTyping) {
    roomTyping.add(user.username);
  } else {
    roomTyping.delete(user.username);
  }

  const typingUpdate = {
    type: WS_MESSAGE_TYPES.TYPING_UPDATE,
    payload: {
      roomId: targetRoomId,
      typingUsers: Array.from(roomTyping),
    },
  };

  if (roomId) {
    broadcastToRoom(roomId, typingUpdate);
  } else {
    broadcastToAll(typingUpdate);
  }
});

// Delete message handler
messageHandlers.set(WS_MESSAGE_TYPES.DELETE_MESSAGE, async (ws, userId, payload) => {
  const user = users.get(userId);
  if (!user) {
    sendError(ws, 'User not authenticated');
    return;
  }

  const { messageId } = payload;

  // Get message from Redis
  const messageData = await redis.get(REDIS_KEYS.message(messageId));
  if (!messageData) {
    sendError(ws, 'Message not found');
    return;
  }

  const message: ServerMessage = JSON.parse(messageData);

  // Verify ownership
  if (message.senderId !== userId) {
    sendError(ws, 'Can only delete your own messages');
    return;
  }

  // Delete from Redis
  await redis.del(REDIS_KEYS.message(messageId));

  // Remove from message lists
  if (message.roomId) {
    await redis.zrem(REDIS_KEYS.roomMessages(message.roomId), messageId);
  } else {
    await redis.zrem(REDIS_KEYS.globalMessages(), messageId);
  }

  // Broadcast deletion
  const deleteBroadcast = {
    type: WS_MESSAGE_TYPES.DELETE_MESSAGE,
    payload: {
      messageId,
      roomId: message.roomId || 'global',
    },
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
  if (!user) {
    sendError(ws, 'User not authenticated');
    return;
  }

  const { fileId } = payload;

  // Get file metadata from Redis
  const fileData = await redis.get(REDIS_KEYS.file(fileId));
  if (!fileData) {
    sendError(ws, 'File not found');
    return;
  }

  const file: ServerFileData = JSON.parse(fileData);

  // Verify ownership
  if (file.ownerId !== userId) {
    sendError(ws, 'Can only delete your own files');
    return;
  }

  // Delete from Cloudinary
  try {
    await cloudinary.uploader.destroy(file.cloudinaryPublicId);
  } catch (err) {
    console.error('Error deleting file from Cloudinary:', err);
  }

  // Delete from Redis
  await redis.del(REDIS_KEYS.file(fileId));

  // Broadcast file deletion
  broadcastToAll({
    type: WS_MESSAGE_TYPES.FILE_DELETED,
    payload: {
      fileId,
    },
  });

  console.log(`File ${fileId} deleted by ${user.username}`);
});

// Ping handler (keep connection alive)
messageHandlers.set(WS_MESSAGE_TYPES.PING, async (ws, userId) => {
  sendToClient(ws, { type: WS_MESSAGE_TYPES.PONG, payload: {} });
});

// Helper functions
function sendToClient(ws: WebSocket, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, error: string) {
  sendToClient(ws, {
    type: WS_MESSAGE_TYPES.ERROR,
    payload: { error },
  });
}

function broadcastToAll(message: any, excludeUserId?: string) {
  const messageStr = JSON.stringify(message);
  clients.forEach((ws, userId) => {
    if (userId !== excludeUserId && ws.readyState === WebSocket.OPEN) {
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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  });
}

async function leaveRoom(userId: string, roomId: string) {
  const user = users.get(userId);
  const room = rooms.get(roomId);

  if (!user || !room) return;

  room.participants.delete(userId);
  user.currentRoom = undefined;

  // Update room in Redis
  if (room.participants.size > 0) {
    await redis.setex(
      REDIS_KEYS.room(roomId),
      EXPIRATION_TIMES.room,
      JSON.stringify({
        ...room,
        participants: Array.from(room.participants),
      })
    );
    await redis.srem(REDIS_KEYS.roomParticipants(roomId), userId);

    // Broadcast user left
    broadcastToRoom(roomId, {
      type: WS_MESSAGE_TYPES.USER_LEFT,
      payload: {
        user: {
          id: userId,
          username: user.username,
        },
        message: {
          id: generateId(),
          content: `${user.username} left the room`,
          type: 'system',
          timestamp: Date.now(),
        },
      },
    });
  } else {
    // Delete empty room
    rooms.delete(roomId);
    await redis.del(REDIS_KEYS.room(roomId));
    await redis.del(REDIS_KEYS.roomParticipants(roomId));
  }

  console.log(`User ${user.username} left room ${room.code}`);
}

async function getGlobalMessages(limit: number = 50): Promise<any[]> {
  const messageIds = await redis.zrevrange(REDIS_KEYS.globalMessages(), 0, limit - 1);
  const messages: any[] = [];

  for (const messageId of messageIds.reverse()) {
    const messageData = await redis.get(REDIS_KEYS.message(messageId));
    if (messageData) {
      const parsed = JSON.parse(messageData);
      messages.push({
        ...parsed,
        sender: {
          id: parsed.senderId,
          username: parsed.senderUsername,
        }
      });
    }
  }

  return messages;
}

async function getRoomMessages(roomId: string, limit: number = 50): Promise<any[]> {
  const messageIds = await redis.zrevrange(REDIS_KEYS.roomMessages(roomId), 0, limit - 1);
  const messages: any[] = [];

  for (const messageId of messageIds.reverse()) {
    const messageData = await redis.get(REDIS_KEYS.message(messageId));
    if (messageData) {
      const parsed = JSON.parse(messageData);
      messages.push({
        ...parsed,
        sender: {
          id: parsed.senderId,
          username: parsed.senderUsername,
        }
      });
    }
  }

  return messages;
}

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket connection');

  ws.on('message', async (data: Buffer) => {
    try {
      const message: WebSocketClientMessage = JSON.parse(data.toString());
      const { type, payload } = message;

      // Find user ID from WebSocket
      let userId: string | undefined;
      for (const [id, client] of clients.entries()) {
        if (client === ws) {
          userId = id;
          break;
        }
      }

      // Handle auth separately (no userId needed)
      if (type === WS_MESSAGE_TYPES.AUTH) {
        const handler = messageHandlers.get(type);
        if (handler) {
          await handler(ws, '', payload);
        }
        return;
      }

      // For other handlers, user must be authenticated
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
    // Find and remove user
    for (const [id, client] of clients.entries()) {
      if (client === ws) {
        const user = users.get(id);
        if (user) {
          // Leave current room if in one
          if (user.currentRoom) {
            leaveRoom(id, user.currentRoom);
          }

          // Broadcast user left global chat
          broadcastToAll({
            type: WS_MESSAGE_TYPES.USER_LEFT,
            payload: {
              user: {
                id,
                username: user.username,
              },
              message: {
                id: generateId(),
                content: `${user.username} left the chat`,
                type: 'system',
                timestamp: Date.now(),
              },
            },
          }, id);

          users.delete(id);
          console.log(`User disconnected: ${user.username}`);
        }
        clients.delete(id);
        break;
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// HTTP Routes

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Download Proxy file endpoint
app.get('/api/download', async (req, res) => {
  const fileUrl = req.query.url as string;
  const fileName = req.query.name as string;

  if (!fileUrl) {
    return res.status(400).json({ error: 'Missing file URL' });
  }

  try {
    const response = await axios({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    // Set attachment header to force download
    res.setHeader('Content-Disposition', `attachment; filename="${fileName || 'download'}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');

    // Pipe the external file directly to the user
    response.data.pipe(res);
  } catch (err: any) {
    console.error('Proxy download error:', err.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { sessionId, roomId } = req.body;

    if (!sessionId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find user by session ID
    let user: ServerUser | undefined;
    for (const u of users.values()) {
      if (u.sessionId === sessionId) {
        user = u;
        break;
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Upload to Cloudinary
    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
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

    const fileData: ServerFileData = {
      fileId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype,
      url: result.secure_url,
      cloudinaryPublicId: result.public_id,
      ownerId: user.id,
      uploadedAt: timestamp,
      expiresAt,
    };

    // Store file metadata in Redis
    await redis.setex(
      REDIS_KEYS.file(fileId),
      EXPIRATION_TIMES.file,
      JSON.stringify(fileData)
    );

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

    console.log(`File uploaded: ${fileData.fileName} by ${user.username}`);
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Get server info
app.get('/api/info', (req, res) => {
  res.json({
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

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Arkion Server running on port ${PORT}`);
  console.log(`WebSocket server ready at ws://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');

  // Close all WebSocket connections
  wss.clients.forEach(ws => {
    ws.close();
  });

  // Close Redis connection
  await redis.quit();

  // Close HTTP server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default server;
