import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { User, Message, Room, UploadProgress } from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import { generateSessionId, generateAnonymousUsername } from '@/lib/utils';

interface WebSocketContextType {
  // Connection state
  connected: boolean;
  connecting: boolean;
  error: string | null;

  // User state
  currentUser: User | null;

  // Messages
  messages: Message[];

  // Room state
  currentRoom: Room | null;
  roomParticipants: User[];

  // Typing indicators
  typingUsers: string[];

  // Upload progress
  uploadProgress: UploadProgress | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string, fileData?: any) => void;
  createRoom: (name?: string, pin?: string) => void;
  joinRoom: (code: string, pin?: string) => void;
  leaveRoom: () => void;
  sendTyping: (isTyping: boolean) => void;
  deleteMessage: (messageId: string) => void;
  uploadFile: (file: File) => Promise<any>;
  setUsername: (username: string) => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionId = useRef<string>(localStorage.getItem('arkion_session_id') || generateSessionId());

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomParticipants, setRoomParticipants] = useState<User[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // Store session ID
  useEffect(() => {
    localStorage.setItem('arkion_session_id', sessionId.current);
  }, []);

  // Auto-remove expired messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => {
        const activeMessages = prev.filter(m => m.expiresAt > now);
        if (activeMessages.length !== prev.length) {
          return activeMessages;
        }
        return prev;
      });
    }, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    setConnecting(true);
    setError(null);

    const wsUrl = DEFAULT_CONFIG.wsUrl;
    console.log('Connecting to WebSocket:', wsUrl);

    try {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        setConnecting(false);
        setError(null);

        // Authenticate
        sendMessage({
          type: 'auth',
          payload: {
            sessionId: sessionId.current,
            username: localStorage.getItem('arkion_username') || generateAnonymousUsername(),
          },
        });

        // Start ping interval
        if (pingInterval.current) {
          clearInterval(pingInterval.current);
        }
        pingInterval.current = setInterval(() => {
          sendMessage({ type: 'ping', payload: {} });
        }, 30000);
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.current.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        setConnecting(false);

        // Clear ping interval
        if (pingInterval.current) {
          clearInterval(pingInterval.current);
          pingInterval.current = null;
        }

        // Attempt reconnection after 3 seconds
        if (!reconnectTimeout.current) {
          reconnectTimeout.current = setTimeout(() => {
            reconnectTimeout.current = null;
            connect();
          }, 3000);
        }
      };

      ws.current.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Connection error. Retrying...');
        setConnecting(false);
      };
    } catch (err) {
      console.error('Error creating WebSocket:', err);
      setError('Failed to connect');
      setConnecting(false);
    }
  }, []);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    if (pingInterval.current) {
      clearInterval(pingInterval.current);
      pingInterval.current = null;
    }

    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }

    setConnected(false);
    setCurrentUser(null);
    setMessages([]);
    setCurrentRoom(null);
    setRoomParticipants([]);
    setTypingUsers([]);
  }, []);

  // Send WebSocket message
  const sendMessage = useCallback((message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message not sent:', message);
    }
  }, []);

  // Handle incoming WebSocket messages
  const handleWebSocketMessage = useCallback((data: any) => {
    const { type, payload } = data;

    switch (type) {
      case 'auth_success':
        setCurrentUser(payload.user);
        localStorage.setItem('arkion_username', payload.user.username);
        break;

      case 'auth_error':
        setError(payload.error);
        break;

      case 'message_received':
        setMessages(prev => {
          // Check if message already exists
          if (prev.some(m => m.id === payload.message.id)) {
            return prev;
          }
          return [...prev, payload.message];
        });
        break;

      case 'message_history':
        setMessages(payload.messages || []);
        break;

      case 'user_joined':
        if (payload.message) {
          setMessages(prev => [...prev, payload.message]);
        }
        if (payload.user && currentRoom) {
          setRoomParticipants(prev => {
            if (prev.some(p => p.id === payload.user.id)) return prev;
            return [...prev, payload.user];
          });
        }
        break;

      case 'user_left':
        if (payload.message) {
          setMessages(prev => [...prev, payload.message]);
        }
        if (payload.user) {
          setRoomParticipants(prev => prev.filter(p => p.id !== payload.user.id));
        }
        break;

      case 'typing_update':
        setTypingUsers(payload.typingUsers || []);
        break;

      case 'room_created':
        setCurrentRoom(payload.room);
        setMessages([]);
        setRoomParticipants([]);
        break;

      case 'room_joined':
        setCurrentRoom(payload.room);
        setMessages([]);
        setRoomParticipants(payload.participants || []);
        break;

      case 'room_left':
        setCurrentRoom(null);
        setMessages([]);
        setRoomParticipants([]);
        setTypingUsers([]);
        break;

      case 'room_error':
        setError(payload.error);
        break;

      case 'delete_message':
        setMessages(prev => prev.filter(m => m.id !== payload.messageId));
        break;

      case 'file_deleted':
        // Handle file deletion if needed
        break;

      case 'error':
        setError(payload.error);
        setTimeout(() => setError(null), 5000);
        break;

      case 'pong':
        // Ping response received
        break;

      default:
        console.log('Unknown message type:', type, payload);
    }
  }, [currentRoom]);

  // Send chat message
  const sendChatMessage = useCallback((content: string, fileData?: any) => {
    if (!content.trim() && !fileData) return;

    sendMessage({
      type: 'send_message',
      payload: {
        content,
        roomId: currentRoom?.id,
        type: fileData ? 'file' : 'text',
        fileData,
      },
    });
  }, [currentRoom, sendMessage]);

  // Create room
  const createRoom = useCallback((name?: string, pin?: string) => {
    sendMessage({
      type: 'create_room',
      payload: { name, pin },
    });
  }, [sendMessage]);

  // Join room
  const joinRoom = useCallback((code: string, pin?: string) => {
    sendMessage({
      type: 'join_room',
      payload: { code, pin },
    });
  }, [sendMessage]);

  // Leave room
  const leaveRoom = useCallback(() => {
    sendMessage({
      type: 'leave_room',
      payload: {},
    });
  }, [sendMessage]);

  // Send typing indicator
  const sendTyping = useCallback((isTyping: boolean) => {
    sendMessage({
      type: 'typing',
      payload: { isTyping, roomId: currentRoom?.id },
    });
  }, [currentRoom, sendMessage]);

  // Delete message
  const deleteMessage = useCallback((messageId: string) => {
    sendMessage({
      type: 'delete_message',
      payload: { messageId },
    });
  }, [sendMessage]);

  // Upload file
  const uploadFile = useCallback(async (file: File): Promise<any> => {
    const fileId = `upload-${Date.now()}`;

    setUploadProgress({
      fileId,
      progress: 0,
      status: 'uploading',
    });

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sessionId', sessionId.current);
    if (currentRoom) {
      formData.append('roomId', currentRoom.id);
    }

    try {
      const response = await fetch(`${DEFAULT_CONFIG.apiUrl}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const data = await response.json();

      setUploadProgress({
        fileId,
        progress: 100,
        status: 'completed',
      });

      // Clear progress after a moment
      setTimeout(() => setUploadProgress(null), 2000);

      return data.file;
    } catch (err: any) {
      setUploadProgress({
        fileId,
        progress: 0,
        status: 'error',
        error: err.message,
      });
      throw err;
    }
  }, [currentRoom]);

  // Set username
  const setUsername = useCallback((username: string) => {
    localStorage.setItem('arkion_username', username);
    // Reconnect with new username
    disconnect();
    connect();
  }, [connect, disconnect]);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  const value: WebSocketContextType = {
    connected,
    connecting,
    error,
    currentUser,
    messages,
    currentRoom,
    roomParticipants,
    typingUsers,
    uploadProgress,
    connect,
    disconnect,
    sendMessage: sendChatMessage,
    createRoom,
    joinRoom,
    leaveRoom,
    sendTyping,
    deleteMessage,
    uploadFile,
    setUsername,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}
