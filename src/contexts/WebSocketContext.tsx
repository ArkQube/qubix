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
  activeSpace: 'global' | 'room';
  switchSpace: (space: 'global' | 'room') => void;
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
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
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
  // Helper to load persisted room on boot/refresh
  const getInitialRoom = (): { room: Room | null; pin?: string } => {
    try {
      let stored = localStorage.getItem('arkion_current_room');
      if (!stored) {
        stored = sessionStorage.getItem('arkion_current_room');
        if (stored) {
          localStorage.setItem('arkion_current_room', stored);
          sessionStorage.removeItem('arkion_current_room');
        }
      }
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.room?.expiresAt && Date.now() > parsed.room.expiresAt) {
          localStorage.removeItem('arkion_current_room');
          return { room: null };
        }
        return parsed;
      }
    } catch {}
    return { room: null };
  };

  const initialRoomData = useRef(getInitialRoom());

  const getInitialSpace = (): 'global' | 'room' => {
    try {
      const savedSpace = localStorage.getItem('arkion_active_space');
      if (savedSpace === 'global' || savedSpace === 'room') {
        if (savedSpace === 'room' && !initialRoomData.current.room) return 'global';
        return savedSpace;
      }
    } catch {}
    return initialRoomData.current.room ? 'room' : 'global';
  };

  const [activeSpace, setActiveSpace] = useState<'global' | 'room'>(getInitialSpace());
  const activeSpaceRef = useRef<'global' | 'room'>(activeSpace);

  useEffect(() => {
    activeSpaceRef.current = activeSpace;
    try {
      localStorage.setItem('arkion_active_space', activeSpace);
    } catch {}
  }, [activeSpace]);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [globalMessages, setGlobalMessages] = useState<Message[]>([]);
  const [roomMessages, setRoomMessages] = useState<Message[]>([]);
  const messages = activeSpace === 'room' ? roomMessages : globalMessages;
  const [currentRoom, setCurrentRoom] = useState<Room | null>(initialRoomData.current.room);
  const [roomParticipants, setRoomParticipants] = useState<User[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // When true, onclose suppresses the "Connection Lost" UI and silently reconnects.
  // Set by ChatInput when the file picker is open (Android kills the socket).
  const suppressDisconnectUI = useRef(false);

  // ─── Ref sync: keep refs that always reflect the latest state ──────────────
  const currentRoomRef = useRef<Room | null>(initialRoomData.current.room);
  const currentRoomPinRef = useRef<string | undefined>(initialRoomData.current.pin);
  const currentUserRef = useRef<User | null>(null);
  const pendingMessages = useRef<any[]>([]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Store session ID
  useEffect(() => {
    localStorage.setItem('arkion_session_id', sessionId.current);
  }, []);

  // Auto-remove expired messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setGlobalMessages(prev => {
        const active = prev.filter(m => m.expiresAt > now);
        return active.length !== prev.length ? active : prev;
      });
      setRoomMessages(prev => {
        const active = prev.filter(m => m.expiresAt > now);
        return active.length !== prev.length ? active : prev;
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // ─── Low-level WS send with resilient offline queueing ──────────────────────
  const flushPendingMessages = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN && pendingMessages.current.length > 0) {
      console.log(`[WS] Flushing ${pendingMessages.current.length} queued messages`);
      const queue = [...pendingMessages.current];
      pendingMessages.current = [];
      queue.forEach(msg => {
        if (msg.type === 'send_message' && !msg.payload?.roomId && activeSpaceRef.current === 'room' && currentRoomRef.current?.id) {
          msg.payload.roomId = currentRoomRef.current.id;
        }
        ws.current?.send(JSON.stringify(msg));
      });
    }
  }, []);

  const sendRaw = useCallback((message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Socket not open, queueing message:', message);
      pendingMessages.current.push(message);
    }
  }, []);

  // ─── Handle incoming messages ────────────────────────────────────────────────
  const handleWebSocketMessage = useCallback((data: any) => {
    const { type, payload } = data;

    switch (type) {
      case 'auth_success': {
        setCurrentUser(payload.user);
        currentUserRef.current = payload.user;
        setError(null); // Wipe out any transient handshake errors
        localStorage.setItem('arkion_username', payload.user.username);

        const urlParams = new URLSearchParams(window.location.search);
        const urlRoomCode = urlParams.get('room');
        if (urlRoomCode && (!currentRoomRef.current || currentRoomRef.current.code !== urlRoomCode.toUpperCase())) {
          sendRaw({
            type: 'join_room',
            payload: {
              code: urlRoomCode.toUpperCase(),
            },
          });
        } else if (currentRoomRef.current) {
          // If the user was in a private room but reopened tab or socket dropped, automatically pull them back in
          sendRaw({
            type: 'join_room',
            payload: {
              code: currentRoomRef.current.code,
              pin: currentRoomPinRef.current // Use the strictly cached plain-text PIN
            }
          });
        }
        flushPendingMessages();
        break;
      }

      case 'auth_error':
        setError(payload.error);
        break;

      case 'message_received': {
        const incomingRoomId: string = payload.roomId || 'global';
        const incomingMsg = payload.message;

        const updateList = (prev: Message[]) => {
          if (prev.some(m => m.id === incomingMsg.id)) return prev;

          // Check if this incoming message confirms an optimistic ghost message
          const ghostIdx = prev.findIndex(m => 
            (m.status === 'sending' && incomingMsg.fileData && m.fileData && 
              (m.fileData.fileId === incomingMsg.fileData.fileId || 
               m.fileData.url === incomingMsg.fileData.url ||
               m.id === incomingMsg.fileData.fileId))
          );

          if (ghostIdx !== -1) {
            const next = [...prev];
            next[ghostIdx] = incomingMsg;
            return next.slice(-100);
          }

          return [...prev, incomingMsg].slice(-100);
        };

        if (incomingRoomId === 'global') {
          setGlobalMessages(updateList);
        } else if (currentRoomRef.current && incomingRoomId === currentRoomRef.current.id) {
          setRoomMessages(updateList);
        }
        break;
      }

      case 'message_history': {
        const historyRoomId = payload.roomId || 'global';
        const serverMsgs: Message[] = payload.messages || [];

        const mergeHistory = (prev: Message[]) => {
          const inFlight = prev.filter(m => m.status === 'sending');
          return [...serverMsgs, ...inFlight.filter(im => !serverMsgs.some(sm => sm.id === im.id))].slice(-100);
        };

        if (historyRoomId === 'global') {
          setGlobalMessages(mergeHistory);
        } else if (currentRoomRef.current && historyRoomId === currentRoomRef.current.id) {
          setRoomMessages(mergeHistory);
        }
        break;
      }

      case 'user_joined': {
        const msgRoomId: string = payload.message?.roomId || 'global';

        if (msgRoomId === 'global') {
          if (payload.message) setGlobalMessages(prev => [...prev, payload.message].slice(-100));
        } else if (currentRoomRef.current && msgRoomId === currentRoomRef.current.id) {
          if (payload.message) setRoomMessages(prev => [...prev, payload.message].slice(-100));
          if (payload.user) {
            setRoomParticipants(prev => {
              if (prev.some(p => p.id === payload.user.id)) return prev;
              return [...prev, payload.user];
            });
          }
        }
        break;
      }

      case 'user_left': {
        const msgRoomId: string = payload.message?.roomId || 'global';

        if (msgRoomId === 'global') {
          if (payload.message) setGlobalMessages(prev => [...prev, payload.message].slice(-100));
        } else if (currentRoomRef.current && msgRoomId === currentRoomRef.current.id) {
          if (payload.message) setRoomMessages(prev => [...prev, payload.message].slice(-100));
          if (payload.user) {
            setRoomParticipants(prev => prev.filter(p => p.id !== payload.user.id));
          }
        }
        break;
      }

      case 'typing_update': {
        const targetRoomId = payload.roomId || 'global';
        const currentSpaceId = activeSpaceRef.current === 'room' && currentRoomRef.current ? currentRoomRef.current.id : 'global';
        if (targetRoomId !== currentSpaceId) break;

        setTypingUsers(payload.typingUsers || []);
        break;
      }

      case 'room_created':
        currentRoomRef.current = payload.room;
        try {
          localStorage.setItem('arkion_current_room', JSON.stringify({
            room: payload.room,
            pin: currentRoomPinRef.current
          }));
        } catch {}
        setCurrentRoom(payload.room);
        setActiveSpace('room');
        setRoomMessages([]);
        setRoomParticipants([]);
        flushPendingMessages();
        break;

      case 'room_joined':
        currentRoomRef.current = payload.room;
        try {
          localStorage.setItem('arkion_current_room', JSON.stringify({
            room: payload.room,
            pin: currentRoomPinRef.current
          }));
        } catch {}
        setCurrentRoom(payload.room);
        setActiveSpace('room');
        // Preserve any in-flight uploading file messages
        setRoomMessages(prev => prev.filter(m => m.status === 'sending'));
        setRoomParticipants(payload.participants || []);
        flushPendingMessages();
        break;

      case 'room_left':
        currentRoomRef.current = null;
        currentRoomPinRef.current = undefined;
        try { localStorage.removeItem('arkion_current_room'); } catch {}
        try { sessionStorage.removeItem('arkion_current_room'); } catch {}
        setCurrentRoom(null);
        setActiveSpace('global');
        setRoomMessages([]);
        setRoomParticipants([]);
        setTypingUsers([]);
        break;

      case 'room_error':
        setError(payload.error);
        if (payload.error === 'Room not found' || payload.error === 'Invalid PIN') {
          currentRoomRef.current = null;
          currentRoomPinRef.current = undefined;
          try { localStorage.removeItem('arkion_current_room'); } catch {}
          try { sessionStorage.removeItem('arkion_current_room'); } catch {}
          setCurrentRoom(null);
          setActiveSpace('global');
          setRoomMessages([]);
          setRoomParticipants([]);
        }
        break;

      case 'delete_message': {
        const targetRoomId = payload.roomId || 'global';
        if (targetRoomId === 'global') {
          setGlobalMessages(prev => prev.filter(m => m.id !== payload.messageId));
        } else {
          setRoomMessages(prev => prev.filter(m => m.id !== payload.messageId));
        }
        break;
      }

      case 'reaction_update': {
        const { messageId, reactions, roomId: targetRoomId } = payload;
        const updateReaction = (prev: Message[]) => prev.map(m => 
          m.id === messageId ? { ...m, reactions } : m
        );
        if (!targetRoomId || targetRoomId === 'global') {
          setGlobalMessages(updateReaction);
        } else {
          setRoomMessages(updateReaction);
        }
        break;
      }

      case 'file_deleted':
        break;

      case 'error':
        if (payload.error === 'Not authenticated' && currentUserRef.current) {
          console.warn('[WS] Suppressed transient unauthenticated packet during handshake');
          break;
        }
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

        // Only wipe messages/participants on FRESH connections if not in a private room.
        if (!isSuppressed && !currentRoomRef.current) {
          setGlobalMessages([]);
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
  }, []);

  // ─── Public actions ───────────────────────────────────────────────────────────
  const switchSpace = useCallback((space: 'global' | 'room') => {
    if (space === 'room' && !currentRoomRef.current) return;
    setActiveSpace(space);
    activeSpaceRef.current = space;
    setTypingUsers([]);

    if (space === 'global') {
      sendRaw({
        type: 'get_history',
        payload: { roomId: undefined },
      });
    } else if (space === 'room' && currentRoomRef.current) {
      sendRaw({
        type: 'get_history',
        payload: { roomId: currentRoomRef.current.id },
      });
    }
  }, [sendRaw]);

  const sendChatMessage = useCallback((content: string, fileData?: any, _ghostId?: string) => {
    if (!content.trim() && !fileData) return;

    const targetRoomId = activeSpaceRef.current === 'room' ? currentRoomRef.current?.id : undefined;

    sendRaw({
      type: 'send_message',
      payload: {
        content,
        roomId: targetRoomId,
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
    currentRoomRef.current = null;
    currentRoomPinRef.current = undefined;
    try { localStorage.removeItem('arkion_current_room'); } catch {}
    try { sessionStorage.removeItem('arkion_current_room'); } catch {}
    setCurrentRoom(null);
    setActiveSpace('global');
    setRoomMessages([]);
    setRoomParticipants([]);
    setTypingUsers([]);
    sendRaw({ type: 'leave_room', payload: {} });
    sendRaw({ type: 'get_history', payload: { roomId: undefined } });
  }, [sendRaw]);

  const sendTyping = useCallback((isTyping: boolean) => {
    const targetRoomId = activeSpaceRef.current === 'room' ? currentRoomRef.current?.id : undefined;
    sendRaw({
      type: 'typing',
      payload: { isTyping, roomId: targetRoomId },
    });
  }, [sendRaw]);

  const deleteMessage = useCallback((messageId: string) => {
    sendRaw({ type: 'delete_message', payload: { messageId } });
  }, [sendRaw]);

  const addReaction = useCallback((messageId: string, emoji: string) => {
    sendRaw({ type: 'add_reaction', payload: { messageId, emoji } });
  }, [sendRaw]);

  const removeReaction = useCallback((messageId: string, emoji: string) => {
    sendRaw({ type: 'remove_reaction', payload: { messageId, emoji } });
  }, [sendRaw]);

  const uploadFile = useCallback(async (file: File, uploadId?: string): Promise<any> => {
    const fileId = uploadId || `upload-${Date.now()}`;
    const previewUrl = URL.createObjectURL(file);
    const targetRoomId = activeSpaceRef.current === 'room' ? (currentRoomRef.current?.id || 'global') : 'global';

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
        roomId: targetRoomId,
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
      if (targetRoomId === 'global') {
        setGlobalMessages(prev => [...prev, ghostMessage]);
      } else {
        setRoomMessages(prev => [...prev, ghostMessage]);
      }
    }

    try {
      // ── Step 1: Get signed Cloudinary credentials from server ──────────────
      const signRes = await fetch(`${DEFAULT_CONFIG.apiUrl}/api/upload/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.current }),
      });

      if (!signRes.ok) {
        const err = await signRes.json();
        throw new Error(err.error || 'Failed to get upload signature');
      }

      const { signature, timestamp, folder, access_mode, apiKey, cloudName } = await signRes.json();

      // ── Step 2: Upload directly to Cloudinary (file travels once) ─────────
      const cloudinaryFormData = new FormData();
      cloudinaryFormData.append('file', file);
      cloudinaryFormData.append('api_key', apiKey);
      cloudinaryFormData.append('timestamp', String(timestamp));
      cloudinaryFormData.append('signature', signature);
      cloudinaryFormData.append('folder', folder);
      // access_mode:'public' must be sent so raw files are publicly accessible.
      // It was part of the signed params, so it MUST also be in the form data.
      if (access_mode) cloudinaryFormData.append('access_mode', access_mode);

      const getResourceType = (mimeType: string) => {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video';
        return 'raw';
      };
      const resourceType = getResourceType(file.type);

      // Use XHR for real-time upload progress
      const cloudinaryResult = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 90); // Reserve 10% for confirm
            setUploadProgress({ fileId, progress: pct, status: 'uploading' });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error?.message || 'Cloudinary upload failed'));
            } catch {
              reject(new Error('Cloudinary upload failed'));
            }
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(cloudinaryFormData);
      });

      // ── Step 3: Confirm metadata with server (for deletion/cleanup) ───────
      const confirmRes = await fetch(`${DEFAULT_CONFIG.apiUrl}/api/upload/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId.current,
          roomId: targetRoomId === 'global' ? undefined : targetRoomId,
          fileId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          url: cloudinaryResult.secure_url,
          cloudinaryPublicId: cloudinaryResult.public_id,
        }),
      });

      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.error || 'Failed to confirm upload');
      }

      const data = await confirmRes.json();
      setUploadProgress({ fileId, progress: 100, status: 'completed' });
      setTimeout(() => setUploadProgress(null), 2000);
      return data.file;
    } catch (err: any) {
      setUploadProgress({ fileId, progress: 0, status: 'error', error: err.message });
      if (targetRoomId === 'global') {
        setGlobalMessages(prev => prev.filter(m => m.id !== fileId));
      } else {
        setRoomMessages(prev => prev.filter(m => m.id !== fileId));
      }
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
    activeSpace,
    switchSpace,
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
    addReaction,
    removeReaction,
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