// Server-side utility functions for Arkion

// Server-side utility functions for Arkion

// Generate random anonymous username
export function generateAnonymousUsername(): string {
  const adjective = USERNAME_ADJECTIVES[Math.floor(Math.random() * USERNAME_ADJECTIVES.length)];
  const noun = USERNAME_NOUNS[Math.floor(Math.random() * USERNAME_NOUNS.length)];
  const number = Math.floor(Math.random() * 999) + 1;
  return `${adjective}${noun}${number}`;
}

// Generate unique session ID
export function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Generate room code (5 characters)
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate random PIN (4 digits)
export function generatePIN(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format timestamp to readable time
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

// Calculate time remaining until expiration
export function getTimeRemaining(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;

  if (diff <= 0) return 'Expired';

  const minutes = Math.floor(diff / (60 * 1000));
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

// Validate room code format
export function validateRoomCode(code: string): boolean {
  return /^[A-Z0-9]{5}$/.test(code.toUpperCase());
}

// Validate PIN format
export function validatePIN(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// Sanitize message content (basic XSS prevention)
export function sanitizeMessage(content: string): string {
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Truncate text with ellipsis
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Get file extension
export function getFileExtension(filename: string): string {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

// Check if file type is allowed
export function isAllowedFileType(mimeType: string): boolean {
  const allowedTypes = [
    // Images
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    // Videos
    'video/mp4', 'video/webm', 'video/ogg',
    // Audio
    'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain', 'text/html', 'text/css', 'text/javascript',
    // Archives
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    // Generic
    'application/octet-stream',
  ];
  return allowedTypes.includes(mimeType);
}

// Anonymous username adjectives and nouns for random generation
const USERNAME_ADJECTIVES = [
  'Silent', 'Swift', 'Bright', 'Dark', 'Mystic', 'Cosmic', 'Quantum', 'Neon',
  'Cyber', 'Digital', 'Electric', 'Solar', 'Lunar', 'Stellar', 'Aurora', 'Nova',
  'Phantom', 'Shadow', 'Ghost', 'Hidden', 'Secret', 'Private', 'Secure', 'Encrypted',
  'Crystal', 'Diamond', 'Golden', 'Silver', 'Bronze', 'Platinum', 'Titanium', 'Steel',
  'Fast', 'Quick', 'Rapid', 'Speedy', 'Lightning', 'Thunder', 'Storm', 'Wave',
  'Fire', 'Ice', 'Frost', 'Flame', 'Blaze', 'Chill', 'Freeze', 'Burn',
  'Wild', 'Free', 'Brave', 'Bold', 'Fierce', 'Calm', 'Peace', 'Serene',
  'Happy', 'Joy', 'Bliss', 'Cheer', 'Sunny', 'Bright', 'Light', 'Glow'
];

const USERNAME_NOUNS = [
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
