import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { User, Message, Room, UploadProgress } from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import { generateSessionId, generateAnonymousUsername } from '@/lib/utils';

interface WebSocketContextType {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  currentUser: User | null;
  messages: Message[];
  currentRoom: Room | null;
  roomParticipants: User[];
  typingUsers: string[];
  uploadProgress: UploadProgress | null;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string, fileData?: any) => void;
  createRoom: (name?: string, pin?: string) => void;
  joinRoom: (code: string, pin?: string) => void;
  leaveRoom: () => void;
  sendTyping: (isTyping: boolean) => void;
  deleteMessage: (messageId: string) => void;
  uploadFile: (file: File, uploadId?: string) => Promise<any>;
  setUsername: (username: string) => void;
  pausePing: () => void;
  resumePing: () => void;
  sendSuspend: () => void;
  sendResume: () => void;
  isSocketAlive: () => boolean;
  forceReconnect: () => void;
  suppressDisconnectUI: React.MutableRefObject<boolean>;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionId = useRef<string>(
    localStorage.getItem('arkion_session_id') || generateSessionId()
  );

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [roomParticipants, setRoomParticipants] = useState<User[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // When true, onclose suppresses the "Connection Lost" UI and silently reconnects.
  // Set by ChatInput when the file picker is open (Android kills the socket).
  const suppressDisconnectUI = useRef(false);

  // ─── FIX 1: keep a ref that always reflects the latest currentRoom ──────────
  //
  // WHY: handleWebSocketMessage is called from ws.onmessage which is set once
  // inside connect() (useCallback with [] deps). Any state variable captured
  // inside that callback is forever stale. Using a ref sidesteps the closure
  // entirely — ref.current is always the live value.
  //
  const currentRoomRef = useRef<Room | null>(null);
  const currentRoomPinRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Store session ID
  useEffect(() => {
    localStorage.setItem('arkion_session_id', sessionId.current);
  }, []);

  // Auto-remove expired messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => {
        const active = prev.filter(m => m.expiresAt > now);
        return active.length !== prev.length ? active : prev;
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // ─── Low-level WS send (internal) ───────────────────────────────────────────
  const sendRaw = useCallback((message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, message not sent:', message);
    }
  }, []);

  // ─── Handle incoming messages ────────────────────────────────────────────────
  const handleWebSocketMessage = useCallback((data: any) => {
    const { type, payload } = data;

    switch (type) {
      case 'auth_success':
        setCurrentUser(payload.user);
        localStorage.setItem('arkion_username', payload.user.username);
        // If the user was in a private room but their socket dropped, automatically pull them back in
        if (currentRoomRef.current) {
          sendRaw({
            type: 'join_room',
            payload: {
              code: currentRoomRef.current.code,
              pin: currentRoomPinRef.current // Use the strictly cached plain-text PIN
            }
          });
        }
        break;

      case 'auth_error':
        setError(payload.error);
        break;

      case 'message_received': {
        // ── FIX 2: filter by roomId ──────────────────────────────────────────
        //
        // The server's broadcastToAll() sends global messages to EVERY connected
        // client, including users inside private rooms. We must discard any
        // message whose roomId doesn't match where this client currently is.
        //
        //  payload.roomId === 'global'  → global chat message
        //  payload.roomId === <uuid>    → private room message
        //
        // We read currentRoomRef.current (not the stale closure value) so this
        // always reflects the user's actual current room.
        //
        const incomingRoomId: string = payload.roomId || 'global';
        const myRoomId: string = currentRoomRef.current?.id || 'global';

        if (incomingRoomId !== myRoomId) {
          // Message belongs to a different space — silently discard
          break;
        }

        setMessages(prev => {
          if (prev.some(m => m.id === payload.message.id)) return prev;
          return [...prev, payload.message].slice(-50);
        });
        break;
      }

      case 'message_history':
        // message_history is always scoped — server only sends history for the
        // space the user just entered, so no extra filtering needed here.
        setMessages(payload.messages || []);
        break;

      case 'user_joined': {
        const msgRoomId: string = payload.message?.roomId || 'global';
        const myRoom: string = currentRoomRef.current?.id || 'global';

        if (msgRoomId !== myRoom) break;

        if (payload.message) {
          setMessages(prev => [...prev, payload.message].slice(-100));
        }
        if (payload.user && currentRoomRef.current) {
          setRoomParticipants(prev => {
            if (prev.some(p => p.id === payload.user.id)) return prev;
            return [...prev, payload.user];
          });
        }
        break;
      }

      case 'user_left': {
        const msgRoomId: string = payload.message?.roomId || 'global';
        const myRoom: string = currentRoomRef.current?.id || 'global';

        if (msgRoomId !== myRoom) break;

        if (payload.message) {
          setMessages(prev => [...prev, payload.message].slice(-100));
        }
        if (payload.user) {
          setRoomParticipants(prev => prev.filter(p => p.id !== payload.user.id));
        }
        break;
      }

      case 'typing_update': {
        const targetRoomId = payload.roomId || 'global';
        const myRoom = currentRoomRef.current?.id || 'global';
        if (targetRoomId !== myRoom) break;

        setTypingUsers(payload.typingUsers || []);
        break;
      }

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
        currentRoomPinRef.current = undefined;
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
        break;

      case 'error':
        setError(payload.error);
        setTimeout(() => setError(null), 5000);
        break;

      case 'pong':
        break;

      default:
        console.log('Unknown message type:', type, payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← intentionally no deps — we use refs for live values

  // ─── Connect ─────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const currentState = ws.current?.readyState;
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) return;

    const isSuppressed = suppressDisconnectUI.current;

    // Only show "Connecting..." spinner for non-suppressed connections
    if (!isSuppressed) {
      setConnecting(true);
    }
    setError(null);

    const wsUrl = DEFAULT_CONFIG.wsUrl;
    console.log('Connecting to WebSocket:', wsUrl, isSuppressed ? '(suppressed)' : '');

    try {
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('WebSocket connected', isSuppressed ? '(suppressed reconnect)' : '');
        setConnected(true);
        setConnecting(false);
        setError(null);

        // Only wipe messages/participants on FRESH connections.
        // Suppressed reconnects (file picker) preserve the chat history —
        // the server re-auths and re-joins the room via session recovery.
        if (!isSuppressed) {
          setMessages([]);
          setRoomParticipants([]);
          setTypingUsers([]);
        }

        sendRaw({
          type: 'auth',
          payload: {
            sessionId: sessionId.current,
            username:
              localStorage.getItem('arkion_username') || generateAnonymousUsername(),
          },
        });

        if (pingInterval.current) clearInterval(pingInterval.current);
        pingInterval.current = setInterval(() => {
          sendRaw({ type: 'ping', payload: {} });
        }, 20_000); // 20s for faster dead-socket detection on mobile focus recovery
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

        if (pingInterval.current) {
          clearInterval(pingInterval.current);
          pingInterval.current = null;
        }

        if (suppressDisconnectUI.current) {
          // File picker is active — Android killed the socket but we don't
          // want the user to see "Connection Lost". Reconnect instantly
          // and silently in the background.
          console.log('[WS] Suppressed disconnect UI (file picker active). Reconnecting instantly...');
          ws.current = null;
          // Don't touch connected/connecting state — keep UI stable
          if (!reconnectTimeout.current) {
            reconnectTimeout.current = setTimeout(() => {
              reconnectTimeout.current = null;
              connect();
            }, 100); // near-instant
          }
        } else {
          setConnected(false);
          setConnecting(false);
          if (!reconnectTimeout.current) {
            reconnectTimeout.current = setTimeout(() => {
              reconnectTimeout.current = null;
              connect();
            }, 3000);
          }
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
  }, [handleWebSocketMessage, sendRaw]);

  // ─── Disconnect ───────────────────────────────────────────────────────────────
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
    currentRoomPinRef.current = undefined;
    setRoomParticipants([]);
    setTypingUsers([]);
  }, []);

  // ─── Public actions ───────────────────────────────────────────────────────────
  const sendChatMessage = useCallback((content: string, fileData?: any, ghostId?: string) => {
    if (!content.trim() && !fileData) return;

    if (ghostId) {
      setMessages(prev => prev.filter(m => m.id !== ghostId)); // Purge optimistic preview
    }

    sendRaw({
      type: 'send_message',
      payload: {
        content,
        roomId: currentRoomRef.current?.id,
        type: fileData ? 'file' : 'text',
        fileData,
      },
    });
  }, [sendRaw]);

  const createRoom = useCallback((name?: string, pin?: string) => {
    currentRoomPinRef.current = pin;
    sendRaw({ type: 'create_room', payload: { name, pin } });
  }, [sendRaw]);

  const joinRoom = useCallback((code: string, pin?: string) => {
    currentRoomPinRef.current = pin;
    sendRaw({ type: 'join_room', payload: { code, pin } });
  }, [sendRaw]);

  const leaveRoom = useCallback(() => {
    currentRoomPinRef.current = undefined;
    sendRaw({ type: 'leave_room', payload: {} });
  }, [sendRaw]);

  const sendTyping = useCallback((isTyping: boolean) => {
    sendRaw({
      type: 'typing',
      payload: { isTyping, roomId: currentRoomRef.current?.id },
    });
  }, [sendRaw]);

  const deleteMessage = useCallback((messageId: string) => {
    sendRaw({ type: 'delete_message', payload: { messageId } });
  }, [sendRaw]);

  const uploadFile = useCallback(async (file: File, uploadId?: string): Promise<any> => {
    const fileId = uploadId || `upload-${Date.now()}`;
    const previewUrl = URL.createObjectURL(file);

    setUploadProgress({ fileId, progress: 0, status: 'uploading' });

    // Inject optimistic visual preview into the chat feed instantly
    if (currentUser) {
      const ghostMessage: Message = {
        id: fileId,
        content: '',
        sender: currentUser,
        timestamp: Date.now(),
        expiresAt: Date.now() + DEFAULT_CONFIG.fileLifetime,
        type: 'file',
        roomId: currentRoomRef.current?.id || 'global',
        status: 'sending',
        fileData: {
          fileId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          url: previewUrl,
          cloudinaryPublicId: '',
          ownerId: currentUser.id,
          uploadedAt: Date.now(),
          expiresAt: Date.now() + DEFAULT_CONFIG.fileLifetime
        }
      };
      setMessages(prev => [...prev, ghostMessage]);
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('sessionId', sessionId.current);
    if (currentRoomRef.current) {
      formData.append('roomId', currentRoomRef.current.id);
    }

    try {
      const response = await fetch(`${DEFAULT_CONFIG.apiUrl}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();
      setUploadProgress({ fileId, progress: 100, status: 'completed' });
      setTimeout(() => setUploadProgress(null), 2000);
      return data.file;
    } catch (err: any) {
      setUploadProgress({ fileId, progress: 0, status: 'error', error: err.message });
      setMessages(prev => prev.filter(m => m.id !== fileId)); // Wipe ghost on fail
      throw err;
    }
  }, [currentUser]);

  const setUsername = useCallback((username: string) => {
    localStorage.setItem('arkion_username', username);
    disconnect();
    connect();
  }, [connect, disconnect]);

  const pausePing = useCallback(() => {
    if (pingInterval.current) {
      clearInterval(pingInterval.current);
      pingInterval.current = null;
    }
  }, []);

  const resumePing = useCallback(() => {
    if (!pingInterval.current && ws.current?.readyState === WebSocket.OPEN) {
      pingInterval.current = setInterval(() => {
        sendRaw({ type: 'ping', payload: {} });
      }, 20_000);
    }
  }, [sendRaw]);

  // Tell the server to skip heartbeat checks for this client (file picker open)
  const sendSuspend = useCallback(() => {
    sendRaw({ type: 'suspend', payload: {} });
  }, [sendRaw]);

  // Tell the server to resume heartbeat checks for this client (file picker closed)
  const sendResume = useCallback(() => {
    sendRaw({ type: 'resume', payload: {} });
  }, [sendRaw]);

  // Check the raw WebSocket readyState — bypasses stale React state
  // Critical for Android: when the tab resumes from suspension, React's
  // `connected` state might still say `true` because setState hasn't flushed.
  const isSocketAlive = useCallback((): boolean => {
    return ws.current?.readyState === WebSocket.OPEN;
  }, []);

  const forceReconnect = useCallback(() => {
    console.log('[WebSocketContext] Forcing reconnect (likely mobile resume)');
    // Suppress the "Connection Lost" UI during this forced reconnect
    suppressDisconnectUI.current = true;
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    // Don't set connected=false — keep UI stable during reconnect
    connect();
    // Reset suppression after a short delay (connection should be established by then)
    setTimeout(() => { suppressDisconnectUI.current = false; }, 5000);
  }, [connect]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => { disconnect(); };
  }, [connect, disconnect]);

  // ─── Visibility Reconnect ──────────────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [connect]);

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
    pausePing,
    resumePing,
    sendSuspend,
    sendResume,
    isSocketAlive,
    forceReconnect,
    suppressDisconnectUI,
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