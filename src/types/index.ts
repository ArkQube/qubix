// Arkion - Ephemeral Real-Time Communication Platform
// Type Definitions

export interface User {
  id: string;
  username: string;
  avatar?: string;
  sessionId: string;
  joinedAt: number;
}

export interface Message {
  id: string;
  content: string;
  sender: User;
  timestamp: number;
  expiresAt: number;
  type: 'text' | 'file' | 'system';
  roomId?: string;
  fileData?: FileData;
}

export interface FileData {
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

export interface Room {
  id: string;
  code: string;
  name?: string;
  pin?: string;
  createdAt: number;
  expiresAt: number;
  participants: string[];
  messageCount: number;
}

export interface ChatState {
  messages: Message[];
  currentUser: User | null;
  connected: boolean;
  currentRoom: Room | null;
  typingUsers: string[];
}

export interface WebSocketMessage {
  type: MessageType;
  payload: any;
  timestamp: number;
}

export type MessageType =
  | 'auth'
  | 'message'
  | 'join_room'
  | 'leave_room'
  | 'create_room'
  | 'typing'
  | 'delete_message'
  | 'delete_file'
  | 'user_joined'
  | 'user_left'
  | 'error'
  | 'pong';

export interface UploadProgress {
  fileId: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

export interface AppConfig {
  maxFileSize: number;
  messageLifetime: number;
  roomLifetime: number;
  fileLifetime: number;
  wsUrl: string;
  apiUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  maxFileSize: 10 * 1024 * 1024, // 10 MB
  messageLifetime: 60 * 60 * 1000, // 1 hour
  roomLifetime: 12 * 60 * 60 * 1000, // 12 hours
  fileLifetime: 60 * 60 * 1000, // 1 hour
  wsUrl: 'wss://qubix-rr27.onrender.com/ws',
  apiUrl: 'https://qubix-rr27.onrender.com',
};

// Anonymous username adjectives and nouns for random generation
export const USERNAME_ADJECTIVES = [
  'Silent', 'Swift', 'Bright', 'Dark', 'Mystic', 'Cosmic', 'Quantum', 'Neon',
  'Cyber', 'Digital', 'Electric', 'Solar', 'Lunar', 'Stellar', 'Aurora', 'Nova',
  'Phantom', 'Shadow', 'Ghost', 'Hidden', 'Secret', 'Private', 'Secure', 'Encrypted',
  'Crystal', 'Diamond', 'Golden', 'Silver', 'Bronze', 'Platinum', 'Titanium', 'Steel',
  'Fast', 'Quick', 'Rapid', 'Speedy', 'Lightning', 'Thunder', 'Storm', 'Wave',
  'Fire', 'Ice', 'Frost', 'Flame', 'Blaze', 'Chill', 'Freeze', 'Burn',
  'Wild', 'Free', 'Brave', 'Bold', 'Fierce', 'Calm', 'Peace', 'Serene',
  'Happy', 'Joy', 'Bliss', 'Cheer', 'Sunny', 'Bright', 'Light', 'Glow'
];

export const USERNAME_NOUNS = [
  'Wolf', 'Fox', 'Bear', 'Lion', 'Tiger', 'Eagle', 'Hawk', 'Falcon',
  'Raven', 'Crow', 'Owl', 'Phoenix', 'Dragon', 'Serpent', 'Shark', 'Whale',
  'Dolphin', 'Octopus', 'Spider', 'Scorpion', 'Wasp', 'Bee', 'Butterfly', 'Moth',
  'Shadow', 'Ghost', 'Spirit', 'Soul', 'Mind', 'Thought', 'Dream', 'Vision',
  'Star', 'Moon', 'Sun', 'Planet', 'Comet', 'Asteroid', 'Nebula', 'Galaxy',
  'Quasar', 'Pulsar', 'Blackhole', 'Void', 'Abyss', 'Depth', 'Peak', 'Summit',
  'Wave', 'Tide', 'Current', 'Stream', 'River', 'Ocean', 'Sea', 'Lake',
  'Flame', 'Spark', 'Ember', 'Ash', 'Smoke', 'Mist', 'Fog', 'Cloud',
  'Crystal', 'Gem', 'Stone', 'Rock', 'Metal', 'Ore', 'Mineral', 'Element',
  'Cipher', 'Code', 'Key', 'Lock', 'Vault', 'Safe', 'Shield', 'Guardian'
];
