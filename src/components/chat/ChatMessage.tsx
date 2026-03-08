import type { Message, User } from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import { formatTime, formatFileSize, getFileIcon, isPreviewableFile, getTimeRemaining } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Image,
  Copy,
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
  const isSystemMessage = message.type === 'system';
  // Use both socket ID and persistent username to maintain visual ownership across page reloads
  const isOwnMessage = !isSystemMessage && (currentUser?.id === message.sender?.id || currentUser?.username === message.sender?.username);

  const handleCopy = () => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
    } else if (message.fileData) {
      navigator.clipboard.writeText(getDownloadUrl(message.fileData.url, message.fileData.fileName));
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

  const getDownloadUrl = (url: string, fileName: string) => {
    // Pipe through our backend proxy to enforce Content-Disposition: attachment for all files (like PDFs)
    return `${DEFAULT_CONFIG.apiUrl}/api/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(fileName)}`;
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
      <div className={`flex flex-col max-w-[70%] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
        {/* Sender Name */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{message.sender.username}</span>
          <span className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {getTimeRemaining(message.expiresAt)}
          </span>
        </div>

        {/* Message Bubble */}
        <div
          className={`relative group rounded-2xl px-4 py-2.5 ${isOwnMessage
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted rounded-tl-sm'
            }`}
        >
          {/* Text Content */}
          {message.content && (
            <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
          )}

          {/* File Attachment */}
          {message.fileData && (
            <div className="mt-2">
              {isPreviewableFile(message.fileData.fileType) ? (
                <div className="rounded-lg overflow-hidden bg-background/50">
                  <img
                    src={message.fileData.url}
                    alt={message.fileData.fileName}
                    className="max-w-full max-h-64 object-contain"
                    loading="lazy"
                  />
                  <div className="p-2 flex items-center justify-between bg-background/80">
                    <div className="flex items-center gap-2 text-xs">
                      {renderFileIcon(message.fileData.fileType)}
                      <span className="truncate max-w-[150px]">{message.fileData.fileName}</span>
                      <span className="text-muted-foreground">({formatFileSize(message.fileData.fileSize)})</span>
                    </div>
                    <a
                      href={getDownloadUrl(message.fileData.url, message.fileData.fileName)}
                      download={message.fileData.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <Download className="w-4 h-4" />
                      </Button>
                    </a>
                  </div>
                </div>
              ) : (
                <div className={`rounded-lg p-3 flex items-center gap-3 ${isOwnMessage ? 'bg-primary-foreground/10' : 'bg-background/50'
                  }`}>
                  <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center">
                    {renderFileIcon(message.fileData.fileType)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{message.fileData.fileName}</p>
                    <p className="text-xs opacity-70">{formatFileSize(message.fileData.fileSize)}</p>
                  </div>
                  <a
                    href={getDownloadUrl(message.fileData.url, message.fileData.fileName)}
                    download={message.fileData.fileName}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Download className="w-4 h-4" />
                    </Button>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons (Copy and Delete) */}
          <div className={`absolute -top-3 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex gap-1 shadow-sm rounded-md bg-background border p-0.5 z-10 ${isOwnMessage ? 'right-0' : '-right-2 translate-x-full'}`}>
            <button
              onClick={handleCopy}
              className="p-1.5 hover:bg-muted rounded-sm text-muted-foreground hover:text-foreground"
              title="Copy message"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            {isOwnMessage && onDelete && (
              <button
                onClick={handleDelete}
                className="p-1.5 hover:bg-destructive hover:text-destructive-foreground rounded-sm text-muted-foreground transition-colors"
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
