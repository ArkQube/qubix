import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { RoomManager } from '../rooms/RoomManager';
import { useWebSocket } from '@/contexts/WebSocketContext';
import {
  Loader2,
  WifiOff,
  Users,
  Clock,
  MessageSquare
} from 'lucide-react';
import { getTimeRemaining } from '@/lib/utils';
import { FileDropOverlay } from './FileDropOverlay';

export function ChatContainer() {
  const {
    connected,
    connecting,
    error,
    currentUser,
    messages,
    currentRoom,
    roomParticipants,
    typingUsers,
    uploadProgress,
    sendMessage,
    createRoom,
    joinRoom,
    leaveRoom,
    deleteMessage,
    uploadFile,
  } = useWebSocket();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Drag and Drop State & Counter Ref
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const dragCounterRef = useRef(0);

  const processDroppedFiles = (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    setDroppedFiles(fileList);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
      dragCounterRef.current += 1;
      setIsDraggingFile(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);

    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      processDroppedFiles(e.dataTransfer.files);
    }
  };

  // WhatsApp-Style auto-scroll
  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    setShowScrollButton(false);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentUser]);

  // Connection status overlay
  if (connecting) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-lg font-medium">Connecting to AQchat...</p>
          <p className="text-sm text-muted-foreground">Establishing secure connection</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <WifiOff className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <p className="text-lg font-medium">Connection Lost</p>
          <p className="text-sm text-muted-foreground">Attempting to reconnect...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      <FileDropOverlay
        isVisible={isDraggingFile}
        targetName={currentRoom ? (currentRoom.name || `Room ${currentRoom.code}`) : 'Global Chat'}
        onDrop={processDroppedFiles}
        onClose={() => {
          dragCounterRef.current = 0;
          setIsDraggingFile(false);
        }}
      />

      {/* Room Manager */}
      <RoomManager
        currentRoom={currentRoom}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        onLeaveRoom={leaveRoom}
      />

      {/* Chat Header - Hidden on mobile to save space, visible on large screens */}
      <div className="hidden sm:flex px-4 py-2 border-b items-center justify-between bg-background/50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span>{currentRoom ? roomParticipants.length : 'Global'} online</span>
          </div>
          {currentRoom && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span>Expires in {getTimeRemaining(currentRoom.expiresAt)}</span>
            </div>
          )}
        </div>
        {typingUsers.length > 0 && (
          <div className="text-sm text-muted-foreground italic">
            {typingUsers.length === 1
              ? `${typingUsers[0]} is typing...`
              : `${typingUsers.length} people are typing...`
            }
          </div>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 relative min-h-0">
        <ScrollArea className="h-full" ref={scrollAreaRef}>
          <div className="p-4 space-y-2">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <MessageSquare className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <p className="text-lg font-medium text-muted-foreground">
                  {currentRoom ? 'Room created!' : 'Welcome to Global Chat'}
                </p>
                <p className="text-sm text-muted-foreground max-w-md">
                  {currentRoom
                    ? 'Share the room code with others to start chatting privately. Messages expire in 12 hours.'
                    : 'Start chatting with everyone. Messages expire after 1 hour for privacy.'
                  }
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  currentUser={currentUser}
                  onDelete={deleteMessage}
                />
              ))
            )}
            <div ref={bottomRef} className="h-1 w-full" />
          </div>
        </ScrollArea>

        {/* Scroll to bottom button */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 bg-primary text-primary-foreground rounded-full p-2 shadow-lg hover:bg-primary/90 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        )}
      </div>

      {/* Error Toast */}
      {error && !(error === 'Not authenticated' && currentUser) && (
        <div className="bg-destructive text-destructive-foreground px-4 py-2 text-sm flex items-center justify-between animate-in fade-in duration-150">
          <span>{error}</span>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSendMessage={sendMessage}
        onUploadFile={uploadFile}
        uploadProgress={uploadProgress}
        disabled={!connected}
        droppedFiles={droppedFiles}
        onClearDroppedFiles={() => setDroppedFiles(null)}
      />
    </div>
  );
}
