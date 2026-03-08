import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { USERNAME_ADJECTIVES, USERNAME_NOUNS } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

// Format timestamp to readable date and time
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
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

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Validate file size
export function validateFileSize(file: File, maxSize: number): boolean {
  return file.size <= maxSize;
}

// Validate room code format
export function validateRoomCode(code: string): boolean {
  return /^[A-Z0-9]{5}$/.test(code.toUpperCase());
}

// Validate PIN format
export function validatePIN(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// Truncate text with ellipsis
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Get file icon based on type
export function getFileIcon(fileType: string): string {
  if (fileType.startsWith('image/')) return 'image';
  if (fileType.startsWith('video/')) return 'video';
  if (fileType.startsWith('audio/')) return 'audio';
  if (fileType.includes('pdf')) return 'pdf';
  if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) return 'archive';
  if (fileType.includes('doc') || fileType.includes('word')) return 'document';
  if (fileType.includes('xls') || fileType.includes('excel') || fileType.includes('sheet')) return 'spreadsheet';
  if (fileType.includes('ppt') || fileType.includes('presentation')) return 'presentation';
  return 'file';
}

// Check if file is previewable (image)
export function isPreviewableFile(fileType: string): boolean {
  return fileType.startsWith('image/');
}

// Debounce function
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Throttle function
export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
