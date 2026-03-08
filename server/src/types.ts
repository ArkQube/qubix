// Server-side type definitions for Arkion

export interface ServerUser {
  id: string;
  username: string;
  sessionId: string;
  socketId: string;
  joinedAt: number;
  currentRoom?: string;
}

export interface ServerMessage {
  id: string;
  content: string;
  senderId: string;
  senderUsername: string;
  timestamp: number;
  expiresAt: number;
  type: 'text' | 'file' | 'system';
  roomId?: string;
  fileData?: ServerFileData;
}

export interface ServerFileData {
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  url: string;
  cloudinaryPublicId: string;
  ownerId: string;
  uploadedAt: number;
  expiresAt: number;
}

export interface ServerRoom {
  id: string;
  code: string;
  name?: string;
  pin?: string;
  createdAt: number;
  expiresAt: number;
  participants: Set<string>;
  messageCount: number;
  creatorId: string;
}

export interface WebSocketClientMessage {
  type: string;
  payload: any;
}

export interface FileMetadata {
  fileId: string;
  ownerId: string;
  roomId: string | 'global';
  fileName: string;
  fileSize: number;
  cloudinaryPublicId: string;
  url: string;
  expiresAt: number;
  uploadedAt: number;
}

// Redis key patterns
export const REDIS_KEYS = {
  message: (id: string) => `message:${id}`,
  room: (id: string) => `room:${id}`,
  file: (id: string) => `file:${id}`,
  user: (id: string) => `user:${id}`,
  roomMessages: (roomId: string) => `room:${roomId}:messages`,
  globalMessages: () => 'global:messages',
  roomParticipants: (roomId: string) => `room:${roomId}:participants`,
};

// Message types for WebSocket communication
export const WS_MESSAGE_TYPES = {
  // Client to Server
  AUTH: 'auth',
  SEND_MESSAGE: 'send_message',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  CREATE_ROOM: 'create_room',
  TYPING: 'typing',
  DELETE_MESSAGE: 'delete_message',
  DELETE_FILE: 'delete_file',
  PING: 'ping',

  // Server to Client
  AUTH_SUCCESS: 'auth_success',
  AUTH_ERROR: 'auth_error',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_HISTORY: 'message_history',
  USER_JOINED: 'user_joined',
  USER_LEFT: 'user_left',
  TYPING_UPDATE: 'typing_update',
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  ROOM_LEFT: 'room_left',
  ROOM_ERROR: 'room_error',
  FILE_DELETED: 'file_deleted',
  ERROR: 'error',
  PONG: 'pong',
} as const;

// Expiration times in seconds
export const EXPIRATION_TIMES = {
  globalMessage: 60 * 60, // 1 hour
  roomMessage: 12 * 60 * 60, // 12 hours
  file: 60 * 60, // 1 hour
  room: 12 * 60 * 60, // 12 hours
  user: 24 * 60 * 60, // 24 hours
};
