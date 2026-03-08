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
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const scrollContainer = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    if (scrollContainer) {
      const isNearBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 150;

      const lastMessage = messages[messages.length - 1];
      const isOwnMessage = currentUser && (lastMessage?.sender?.id === currentUser.id || lastMessage?.sender?.username === currentUser.username);

      // Force a tiny logical delay to ensure the DOM layout engine has painted the new height
      setTimeout(() => {
        if (isNearBottom || isOwnMessage) {
          scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'auto' });
          setShowScrollButton(false);
        } else {
          setShowScrollButton(true);
        }
      }, 50);
    }
  }, [messages, currentUser]);

  const scrollToBottom = () => {
    const scrollContainer = document.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
      setShowScrollButton(false);
    }
  };

  // Connection status overlay
  if (connecting) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-lg font-medium">Connecting to Arkion...</p>
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
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      {/* Room Manager */}
      <RoomManager
        currentRoom={currentRoom}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        onLeaveRoom={leaveRoom}
      />

      {/* Chat Header */}
      <div className="px-4 py-2 border-b flex items-center justify-between bg-background/50">
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
      {error && (
        <div className="bg-destructive text-destructive-foreground px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSendMessage={sendMessage}
        onUploadFile={uploadFile}
        uploadProgress={uploadProgress}
        disabled={!connected}
      />
    </div>
  );
}
