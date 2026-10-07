import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { User, Message, Room, UploadProgress } from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import { generateSessionId, generateAnonymousUsername } from '@/lib/utils';

export interface StoredRoomEntry {
  room: Room;
  pin?: string;
}

interface WebSocketContextType {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  currentUser: User | null;
  messages: Message[];
  currentRoom: Room | null;
  joinedRooms: Room[];
  activeSpace: string; // 'global' or roomId
  switchSpace: (space: string) => void;
  roomParticipants: User[];
  allRoomParticipants: Record<string, User[]>;
  typingUsers: string[];
  unreadCounts: Record<string, number>;
  uploadProgress: UploadProgress | null;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (content: string, fileData?: any) => void;
  createRoom: (name?: string, pin?: string) => void;
  joinRoom: (code: string, pin?: string) => void;
  leaveRoom: (roomId?: string) => void;
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

// Helper to load persisted rooms on boot/refresh
const getInitialJoinedRooms = (): StoredRoomEntry[] => {
  try {
    let list: StoredRoomEntry[] = [];
    const stored = localStorage.getItem('arkion_joined_rooms');
    if (stored) {
      try {
        list = JSON.parse(stored);
      } catch {}
    }

    // Also migrate legacy single room if exists and not already in list
    const legacy = localStorage.getItem('arkion_current_room');
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (parsed?.room?.id && !list.some(item => item.room?.id === parsed.room.id)) {
          list.push(parsed);
        }
      } catch {}
    }

    const now = Date.now();
    // Filter out expired rooms
    const active = list.filter(item => item.room?.expiresAt && item.room.expiresAt > now);
    if (active.length !== list.length) {
      localStorage.setItem('arkion_joined_rooms', JSON.stringify(active));
    }
    return active;
  } catch {
    return [];
  }
};

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

  const initialEntries = useRef<StoredRoomEntry[]>(getInitialJoinedRooms());
  const cachedRoomPins = useRef<Record<string, string>>({});
  const lastCreatedPin = useRef<string | undefined>(undefined);
  const targetJoiningRoomCode = useRef<string | null>(null);

  initialEntries.current.forEach(e => {
    if (e.pin && e.room?.code) cachedRoomPins.current[e.room.code.toUpperCase()] = e.pin;
  });

  const [joinedRooms, setJoinedRooms] = useState<Room[]>(
    initialEntries.current.map(e => e.room).filter(Boolean)
  );
  const joinedRoomsRef = useRef<Room[]>(joinedRooms);

  // Sync joinedRooms ref and localStorage
  useEffect(() => {
    joinedRoomsRef.current = joinedRooms;
    try {
      const stored = localStorage.getItem('arkion_joined_rooms');
      const existing: StoredRoomEntry[] = stored ? JSON.parse(stored) : [];
      const updated: StoredRoomEntry[] = joinedRooms.map(r => {
        const found = existing.find(e => e.room?.id === r.id);
        return {
          room: r,
          pin: found?.pin || cachedRoomPins.current[r.code.toUpperCase()]
        };
      });
      localStorage.setItem('arkion_joined_rooms', JSON.stringify(updated));
    } catch {}
  }, [joinedRooms]);

  const getInitialSpace = (): string => {
    try {
      const savedSpace = localStorage.getItem('arkion_active_space');
      if (savedSpace === 'global') return 'global';
      if (savedSpace && joinedRoomsRef.current.some(r => r.id === savedSpace)) {
        return savedSpace;
      }
    } catch {}
    return 'global';
  };

  const [activeSpace, setActiveSpace] = useState<string>(getInitialSpace());
  const activeSpaceRef = useRef<string>(activeSpace);

  useEffect(() => {
    activeSpaceRef.current = activeSpace;
    try {
      localStorage.setItem('arkion_active_space', activeSpace);
    } catch {}
  }, [activeSpace]);

  // Current active room (or null if in global chat)
  const currentRoom = activeSpace === 'global' ? null : (joinedRooms.find(r => r.id === activeSpace) || null);
  const currentRoomRef = useRef<Room | null>(currentRoom);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [globalMessages, setGlobalMessages] = useState<Message[]>([]);
  const [roomMessages, setRoomMessages] = useState<Record<string, Message[]>>({});
  const messages = activeSpace === 'global' ? globalMessages : (roomMessages[activeSpace] || []);

  const [allRoomParticipants, setAllRoomParticipants] = useState<Record<string, User[]>>({});
  const roomParticipants = activeSpace === 'global' ? [] : (allRoomParticipants[activeSpace] || []);

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  // When true, onclose suppresses the "Connection Lost" UI and silently reconnects.
  const suppressDisconnectUI = useRef(false);

  const currentUserRef = useRef<User | null>(null);
  const pendingMessages = useRef<any[]>([]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Store session ID
  useEffect(() => {
    localStorage.setItem('arkion_session_id', sessionId.current);
  }, []);

  // Auto-remove expired messages and rooms
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setGlobalMessages(prev => {
        const active = prev.filter(m => m.expiresAt > now);
        return active.length !== prev.length ? active : prev;
      });
      setRoomMessages(prev => {
        let changed = false;
        const next: Record<string, Message[]> = {};
        for (const [rid, msgs] of Object.entries(prev)) {
          const active = msgs.filter(m => m.expiresAt > now);
          if (active.length !== msgs.length) changed = true;
          next[rid] = active;
        }
        return changed ? next : prev;
      });
      setJoinedRooms(prev => {
        const active = prev.filter(r => r.expiresAt > now);
        if (active.length !== prev.length) {
          // If active space was in expired room, switch to global
          if (activeSpaceRef.current !== 'global' && !active.some(r => r.id === activeSpaceRef.current)) {
            setActiveSpace('global');
          }
          return active;
        }
        return prev;
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
        if (msg.type === 'send_message' && !msg.payload?.roomId && activeSpaceRef.current !== 'global') {
          msg.payload.roomId = activeSpaceRef.current;
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
        setError(null);
        localStorage.setItem('arkion_username', payload.user.username);

        // Check if there's a room parameter in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const urlRoomCode = urlParams.get('room');
        if (urlRoomCode) {
          const upper = urlRoomCode.toUpperCase();
          targetJoiningRoomCode.current = upper;
          sendRaw({
            type: 'join_room',
            payload: { code: upper },
          });
        }

        // Rejoin all currently enrolled rooms
        initialEntries.current.forEach(entry => {
          if (entry.room?.code) {
            const cachedPin = entry.pin || cachedRoomPins.current[entry.room.code.toUpperCase()];
            sendRaw({
              type: 'join_room',
              payload: {
                code: entry.room.code,
                pin: cachedPin
              }
            });
          }
        });

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
        } else {
          setRoomMessages(prev => ({
            ...prev,
            [incomingRoomId]: updateList(prev[incomingRoomId] || [])
          }));

          // Track unread badge if message is for another room
          if (activeSpaceRef.current !== incomingRoomId) {
            setUnreadCounts(prev => ({
              ...prev,
              [incomingRoomId]: (prev[incomingRoomId] || 0) + 1
            }));
          }
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
        } else {
          setRoomMessages(prev => ({
            ...prev,
            [historyRoomId]: mergeHistory(prev[historyRoomId] || [])
          }));
        }
        break;
      }

      case 'user_joined': {
        const msgRoomId: string = payload.message?.roomId || 'global';

        if (msgRoomId === 'global') {
          if (payload.message) setGlobalMessages(prev => [...prev, payload.message].slice(-100));
        } else {
          if (payload.message) {
            setRoomMessages(prev => ({
              ...prev,
              [msgRoomId]: [...(prev[msgRoomId] || []), payload.message].slice(-100)
            }));
          }
          if (payload.user) {
            setAllRoomParticipants(prev => {
              const current = prev[msgRoomId] || [];
              if (current.some(p => p.id === payload.user.id)) return prev;
              return { ...prev, [msgRoomId]: [...current, payload.user] };
            });
          }
        }
        break;
      }

      case 'user_left': {
        const msgRoomId: string = payload.message?.roomId || 'global';

        if (msgRoomId === 'global') {
          if (payload.message) setGlobalMessages(prev => [...prev, payload.message].slice(-100));
        } else {
          if (payload.message) {
            setRoomMessages(prev => ({
              ...prev,
              [msgRoomId]: [...(prev[msgRoomId] || []), payload.message].slice(-100)
            }));
          }
          if (payload.user) {
            setAllRoomParticipants(prev => {
              const current = prev[msgRoomId] || [];
              return { ...prev, [msgRoomId]: current.filter(p => p.id !== payload.user.id) };
            });
          }
        }
        break;
      }

      case 'typing_update': {
        const targetRoomId = payload.roomId || 'global';
        const currentSpaceId = activeSpaceRef.current !== 'global' ? activeSpaceRef.current : 'global';
        if (targetRoomId !== currentSpaceId) break;

        setTypingUsers(payload.typingUsers || []);
        break;
      }

      case 'room_created': {
        const newRoom: Room = payload.room;
        if (lastCreatedPin.current && newRoom.code) {
          cachedRoomPins.current[newRoom.code.toUpperCase()] = lastCreatedPin.current;
        }

        setJoinedRooms(prev => {
          const filtered = prev.filter(r => r.id !== newRoom.id);
          return [newRoom, ...filtered];
        });
        setActiveSpace(newRoom.id);
        setRoomMessages(prev => ({ ...prev, [newRoom.id]: [] }));
        setAllRoomParticipants(prev => ({
          ...prev,
          [newRoom.id]: currentUserRef.current ? [currentUserRef.current] : []
        }));
        flushPendingMessages();
        break;
      }

      case 'room_joined': {
        const joinedRoom: Room = payload.room;
        setJoinedRooms(prev => {
          const filtered = prev.filter(r => r.id !== joinedRoom.id);
          return [...filtered, joinedRoom];
        });

        // If this was an explicit user join action, switch to it immediately
        if (targetJoiningRoomCode.current === joinedRoom.code.toUpperCase()) {
          setActiveSpace(joinedRoom.id);
          targetJoiningRoomCode.current = null;
        } else if (activeSpaceRef.current === joinedRoom.id) {
          // already selected
        }

        setAllRoomParticipants(prev => ({
          ...prev,
          [joinedRoom.id]: payload.participants || []
        }));
        flushPendingMessages();
        break;
      }

      case 'room_left': {
        const leftRoomId: string = payload.roomId;
        setJoinedRooms(prev => prev.filter(r => r.id !== leftRoomId));
        if (activeSpaceRef.current === leftRoomId) {
          setActiveSpace('global');
        }
        setRoomMessages(prev => {
          const next = { ...prev };
          delete next[leftRoomId];
          return next;
        });
        setAllRoomParticipants(prev => {
          const next = { ...prev };
          delete next[leftRoomId];
          return next;
        });
        break;
      }

      case 'room_error': {
        setError(payload.error);
        if (payload.error === 'Room not found' || payload.error === 'Invalid PIN') {
          // Remove invalid room from cache if it failed
          if (targetJoiningRoomCode.current) {
            targetJoiningRoomCode.current = null;
          }
        }
        break;
      }

      case 'delete_message': {
        const targetRoomId = payload.roomId || 'global';
        if (targetRoomId === 'global') {
          setGlobalMessages(prev => prev.filter(m => m.id !== payload.messageId));
        } else {
          setRoomMessages(prev => ({
            ...prev,
            [targetRoomId]: (prev[targetRoomId] || []).filter(m => m.id !== payload.messageId)
          }));
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
          setRoomMessages(prev => ({
            ...prev,
            [targetRoomId]: updateReaction(prev[targetRoomId] || [])
          }));
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
  }, [flushPendingMessages, sendRaw]);

  // ─── Connect ─────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    const currentState = ws.current?.readyState;
    if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) return;

    const isSuppressed = suppressDisconnectUI.current;

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

        if (!isSuppressed && joinedRoomsRef.current.length === 0) {
          setGlobalMessages([]);
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
        }, 20_000);
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
          console.log('[WS] Suppressed disconnect UI (file picker active). Reconnecting instantly...');
          ws.current = null;
          if (!reconnectTimeout.current) {
            reconnectTimeout.current = setTimeout(() => {
              reconnectTimeout.current = null;
              connect();
            }, 100);
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
  const switchSpace = useCallback((space: string) => {
    let target = space;
    if (target !== 'global') {
      // Support legacy 'room' string
      if (target === 'room') {
        if (joinedRoomsRef.current.length > 0) {
          target = joinedRoomsRef.current[0].id;
        } else {
          target = 'global';
        }
      } else if (!joinedRoomsRef.current.some(r => r.id === target)) {
        target = 'global';
      }
    }

    setActiveSpace(target);
    activeSpaceRef.current = target;
    setTypingUsers([]);

    if (target !== 'global') {
      // Clear unread badge
      setUnreadCounts(prev => ({ ...prev, [target]: 0 }));
      sendRaw({
        type: 'get_history',
        payload: { roomId: target },
      });
    } else {
      sendRaw({
        type: 'get_history',
        payload: { roomId: undefined },
      });
    }
  }, [sendRaw]);

  const sendChatMessage = useCallback((content: string, fileData?: any, _ghostId?: string) => {
    if (!content.trim() && !fileData) return;

    const targetRoomId = activeSpaceRef.current !== 'global' ? activeSpaceRef.current : undefined;

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
    lastCreatedPin.current = pin;
    sendRaw({ type: 'create_room', payload: { name, pin } });
  }, [sendRaw]);

  const joinRoom = useCallback((code: string, pin?: string) => {
    const upperCode = code.toUpperCase();
    if (pin) {
      cachedRoomPins.current[upperCode] = pin;
    }
    targetJoiningRoomCode.current = upperCode;
    sendRaw({ type: 'join_room', payload: { code: upperCode, pin } });
  }, [sendRaw]);

  const leaveRoom = useCallback((targetRoomId?: string) => {
    const rid = targetRoomId || (activeSpaceRef.current !== 'global' ? activeSpaceRef.current : undefined) || joinedRoomsRef.current[0]?.id;
    if (!rid) return;

    setJoinedRooms(prev => {
      const updated = prev.filter(r => r.id !== rid);
      try {
        const stored = localStorage.getItem('arkion_joined_rooms');
        if (stored) {
          const list = JSON.parse(stored).filter((e: any) => e.room?.id !== rid);
          localStorage.setItem('arkion_joined_rooms', JSON.stringify(list));
        }
      } catch {}
      return updated;
    });

    if (activeSpaceRef.current === rid) {
      setActiveSpace('global');
      activeSpaceRef.current = 'global';
    }

    setRoomMessages(prev => {
      const next = { ...prev };
      delete next[rid];
      return next;
    });

    setAllRoomParticipants(prev => {
      const next = { ...prev };
      delete next[rid];
      return next;
    });

    sendRaw({ type: 'leave_room', payload: { roomId: rid } });
    sendRaw({ type: 'get_history', payload: { roomId: undefined } });
  }, [sendRaw]);

  const sendTyping = useCallback((isTyping: boolean) => {
    const targetRoomId = activeSpaceRef.current !== 'global' ? activeSpaceRef.current : undefined;
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
    const targetRoomId = activeSpaceRef.current !== 'global' ? activeSpaceRef.current : 'global';

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
        setRoomMessages(prev => ({
          ...prev,
          [targetRoomId]: [...(prev[targetRoomId] || []), ghostMessage]
        }));
      }
    }

    try {
      // Step 1: Get signed Cloudinary credentials from server
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

      // Step 2: Upload directly to Cloudinary
      const cloudinaryFormData = new FormData();
      cloudinaryFormData.append('file', file);
      cloudinaryFormData.append('api_key', apiKey);
      cloudinaryFormData.append('timestamp', String(timestamp));
      cloudinaryFormData.append('signature', signature);
      cloudinaryFormData.append('folder', folder);
      if (access_mode) cloudinaryFormData.append('access_mode', access_mode);

      const getResourceType = (mimeType: string) => {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'video';
        return 'raw';
      };
      const resourceType = getResourceType(file.type);

      const cloudinaryResult = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 90);
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

      // Step 3: Confirm metadata with server
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
        setRoomMessages(prev => ({
          ...prev,
          [targetRoomId]: (prev[targetRoomId] || []).filter(m => m.id !== fileId)
        }));
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

  const sendSuspend = useCallback(() => {
    sendRaw({ type: 'suspend', payload: {} });
  }, [sendRaw]);

  const sendResume = useCallback(() => {
    sendRaw({ type: 'resume', payload: {} });
  }, [sendRaw]);

  const isSocketAlive = useCallback((): boolean => {
    return ws.current?.readyState === WebSocket.OPEN;
  }, []);

  const forceReconnect = useCallback(() => {
    console.log('[WebSocketContext] Forcing reconnect (likely mobile resume)');
    suppressDisconnectUI.current = true;
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    connect();
    setTimeout(() => { suppressDisconnectUI.current = false; }, 5000);
  }, [connect]);

  // Auto-connect on mount
  useEffect(() => {
    connect();
    return () => { disconnect(); };
  }, [connect, disconnect]);

  // Visibility Reconnect
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
    joinedRooms,
    activeSpace,
    switchSpace,
    roomParticipants,
    allRoomParticipants,
    typingUsers,
    unreadCounts,
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