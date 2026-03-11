import { useState, useRef, useEffect } from 'react';
import he from 'he';
import Linkify from 'linkify-react';
import type { Message, User } from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import { formatTime, formatFileSize, getFileIcon, isPreviewableFile, getTimeRemaining } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Image,
  Copy,
  Check,
  Video,
  Music,
  File,
  Download,
  Trash2,
  Clock
} from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  currentUser: User | null;
  onDelete?: (messageId: string) => void;
}

export function ChatMessage({ message, currentUser, onDelete }: ChatMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isActive, setIsActive] = useState(false); // Touch-screen overlay toggle state
  const messageRef = useRef<HTMLDivElement>(null);

  const isSystemMessage = message.type === 'system';
  // Use both socket ID and persistent username to maintain visual ownership across page reloads
  const isOwnMessage = !isSystemMessage && (currentUser?.id === message.sender?.id || currentUser?.username === message.sender?.username);

  const copyTextToClipboard = async () => {
    if (message.content) {
      try {
        await navigator.clipboard.writeText(he.decode(message.content));
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    }
  };

  const downloadFile = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!message.fileData) return;

    try {
      const proxyUrl = `${DEFAULT_CONFIG.apiUrl}/api/download?url=${encodeURIComponent(message.fileData.url)}&name=${encodeURIComponent(message.fileData.fileName)}`;

      // Fetch the file as a blob to guarantee same-origin and bypass browser strict security
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Failed to download');

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      // Create a temporary hidden link element to safely trigger a native Save Dialog
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = message.fileData.fileName;
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  if (isSystemMessage) {
    return (
      <div className="flex justify-center my-4">
        <span className="text-xs text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  // Handle outside clicks to close the mobile menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (messageRef.current && !messageRef.current.contains(event.target as Node)) {
        setIsActive(false);
      }
    };

    if (isActive) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isActive]);

  const handleDelete = () => {
    if (onDelete && isOwnMessage) {
      onDelete(message.id);
    }
  };

  const renderFileIcon = (fileType: string) => {
    const iconType = getFileIcon(fileType);
    switch (iconType) {
      case 'image':
        return <Image className="w-5 h-5" />;
      case 'video':
        return <Video className="w-5 h-5" />;
      case 'audio':
        return <Music className="w-5 h-5" />;
      case 'pdf':
      case 'document':
        return <FileText className="w-5 h-5" />;
      default:
        return <File className="w-5 h-5" />;
    }
  };

  return (
    <div
      className={`flex gap-3 mb-4 ${isOwnMessage ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${isOwnMessage
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground'
          }`}>
          {message.sender.username.charAt(0).toUpperCase()}
        </div>
      </div>

      {/* Message Content */}
      <div className={`flex flex-col max-w-[85vw] md:max-w-[70%] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
        {/* Sender Name */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{message.sender.username}</span>
          <span className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {getTimeRemaining(message.expiresAt)}
          </span>
        </div>

        {/* Message Bubble + Touchable Surface */}
        <div
          ref={messageRef}
          onClick={() => setIsActive(!isActive)}
          className={`relative group rounded-2xl px-4 py-2.5 cursor-pointer md:cursor-default transition-all ${isOwnMessage
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted rounded-tl-sm'
            } ${isActive ? 'ring-2 ring-primary/50' : ''}`}
        >
          {/* Text Content */}
          {message.content && (
            <div className="text-sm whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>
              <Linkify options={{ 
                target: '_blank', 
                rel: 'noopener noreferrer',
                className: 'underline font-medium hover:opacity-80 transition-opacity'
              }}>
                {he.decode(message.content)}
              </Linkify>
            </div>
          )}

          {/* File Attachment */}
          {message.fileData && (
            <div className="mt-2">
              {isPreviewableFile(message.fileData.fileType) ? (
                <div className="rounded-lg overflow-hidden bg-background/50">
                  <img
                    src={message.fileData.url}
                    alt={message.fileData.fileName}
                    className="w-full block max-w-full max-h-64 object-contain bg-background/20"
                    loading="lazy"
                  />
                  <div className="p-2 flex items-center justify-between bg-background/80">
                    <div className="flex items-center gap-2 text-xs min-w-0">
                      <div className="shrink-0">{renderFileIcon(message.fileData.fileType)}</div>
                      <span className="break-all max-w-[150px]">{message.fileData.fileName}</span>
                      <span className="text-muted-foreground shrink-0">({formatFileSize(message.fileData.fileSize)})</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={downloadFile}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={`rounded-lg p-3 flex items-center gap-3 ${isOwnMessage ? 'bg-primary-foreground/10' : 'bg-background/50'
                  }`}>
                  <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center">
                    {renderFileIcon(message.fileData.fileType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium break-all">{message.fileData.fileName}</p>
                    <p className="text-xs opacity-70">{formatFileSize(message.fileData.fileSize)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={downloadFile}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons (Copy and Delete) */}
          <div className={`absolute top-2 right-2 md:-top-3 
            ${isActive ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none md:pointer-events-auto'} 
            md:opacity-0 md:group-hover:opacity-100 md:scale-100 transition-all flex gap-1 shadow-md md:shadow-sm rounded-md bg-background/95 md:bg-background border p-1 z-10 backdrop-blur-md md:backdrop-blur-none origin-bottom-right md:origin-center
            ${isOwnMessage ? 'md:right-0' : 'md:-right-2 md:translate-x-full'}`}>
            {message.content && (
              <button
                onClick={(e) => { e.stopPropagation(); copyTextToClipboard(); }}
                className={`p-1.5 hover:bg-muted rounded-md transition-colors ${isCopied ? 'text-green-500' : 'text-foreground/70 hover:text-foreground'}`}
                title="Copy text"
              >
                {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
            {isOwnMessage && onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(); }}
                className="p-1.5 hover:bg-destructive hover:text-destructive-foreground rounded-md text-foreground/70 transition-colors"
                title="Delete message"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
