import { useState, useRef, useEffect } from 'react';
import he from 'he';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message, User } from '@/types';
import { DEFAULT_CONFIG } from '@/types';
import { formatTime, formatFileSize, getFileIcon, isPreviewableFile, getTimeRemaining } from '@/lib/utils';
import { useWebSocket } from '@/contexts/WebSocketContext';
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
  Clock,
  SmilePlus
} from 'lucide-react';

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '🔥', '👀', '✨'];

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
  const isOwnMessage = !isSystemMessage && (currentUser?.id === message.sender?.id || currentUser?.username === message.sender?.username);

  const { addReaction, removeReaction } = useWebSocket();

  const handleToggleReaction = (emoji: string) => {
    if (!currentUser) return;
    const hasReacted = message.reactions?.[emoji]?.includes(currentUser.username);
    if (hasReacted) {
      removeReaction(message.id, emoji);
    } else {
      addReaction(message.id, emoji);
    }
    setIsActive(false);
  };

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

  const downloadFile = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!message.fileData) return;

    try {
      const proxyUrl = `${DEFAULT_CONFIG.apiUrl}/api/download?url=${encodeURIComponent(message.fileData.url)}&name=${encodeURIComponent(message.fileData.fileName)}`;

      // Open in a new tab — the backend sends Content-Disposition: attachment
      // which forces a download. If the proxy fails, it redirects to Cloudinary
      // directly. Using _blank ensures the chat page is never navigated away.
      window.open(proxyUrl, '_blank');
    } catch (err) {
      console.error('Download error:', err);
      // Ultimate fallback: open the raw Cloudinary URL directly
      window.open(message.fileData.url, '_blank');
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
            <div className="text-[15px] leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline ? (
                      <div className="my-2 rounded-md overflow-hidden" onClick={e => e.stopPropagation()}>
                        <SyntaxHighlighter
                          style={vscDarkPlus as any}
                          language={match ? match[1] : 'text'}
                          PreTag="div"
                          className="!m-0 !text-xs !bg-[#1E1E1E]"
                          showLineNumbers={true}
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      </div>
                    ) : (
                      <code className="bg-black/20 dark:bg-white/20 px-1.5 py-0.5 rounded font-mono text-[13px]" {...props}>
                        {children}
                      </code>
                    );
                  },
                  a: ({ node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:opacity-80 transition-opacity text-blue-400 dark:text-blue-300" onClick={e => e.stopPropagation()} />
                  ),
                  p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                  ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-2 space-y-1" {...props} />,
                  ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...props} />,
                  blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-primary/50 pl-3 italic opacity-80 my-2" {...props} />,
                }}
              >
                {he.decode(message.content)}
              </ReactMarkdown>
            </div>
          )}

          {/* File Attachment */}
          {message.fileData && (
            <div className="mt-2">
              {message.fileData.fileType.startsWith('audio/') ? (
                <div className={`rounded-lg p-2 flex flex-col gap-2 ${isOwnMessage ? 'bg-primary-foreground/10' : 'bg-background/50'}`}>
                  <audio controls src={message.fileData.url} className="h-10 w-[200px] md:w-[250px] outline-none" />
                </div>
              ) : isPreviewableFile(message.fileData.fileType) ? (
                <div className="rounded-lg overflow-hidden relative group/image">
                  <img
                    src={message.fileData.url}
                    alt={message.fileData.fileName}
                    className="w-full max-w-full max-h-[20rem] object-cover block"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between bg-black/60 backdrop-blur-md text-white opacity-100 transition-opacity">
                    <div className="flex items-center gap-2 text-xs min-w-0">
                      <div className="shrink-0">{renderFileIcon(message.fileData.fileType)}</div>
                      <span className="truncate max-w-[80px] sm:max-w-[120px] font-medium" title={message.fileData.fileName}>{message.fileData.fileName}</span>
                      <span className="text-white/70 shrink-0">({formatFileSize(message.fileData.fileSize)})</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-white hover:text-white hover:bg-white/20"
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

          {/* Render Reactions */}
          {message.reactions && Object.keys(message.reactions).length > 0 && (
            <div className={`flex flex-wrap gap-1 mt-2 -mb-1 ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
              {Object.entries(message.reactions).map(([emoji, users]) => {
                const hasReacted = currentUser && users.includes(currentUser.username);
                return (
                  <button
                    key={emoji}
                    onClick={(e) => { e.stopPropagation(); handleToggleReaction(emoji); }}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors shadow-sm
                      ${hasReacted 
                        ? 'bg-primary/20 border-primary/30 text-foreground' 
                        : 'bg-background/80 border-border/50 text-muted-foreground hover:bg-background'
                      }`}
                    title={`${users.join(', ')} reacted with ${emoji}`}
                  >
                    <span>{emoji}</span>
                    <span className="opacity-80 pb-[1px]">{users.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Action Buttons (Copy, Delete, React) */}
          <div className={`absolute top-2 right-2 md:-top-3 
            ${isActive ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none md:pointer-events-auto'} 
            md:opacity-0 md:group-hover:opacity-100 md:scale-100 transition-all flex gap-1 shadow-md md:shadow-sm rounded-md bg-background/95 md:bg-background border p-1 z-10 backdrop-blur-md md:backdrop-blur-none origin-bottom-right md:origin-center
            ${isOwnMessage ? 'md:right-0' : 'md:-right-2 md:translate-x-full'}`}>
            
            {/* Mobile Reaction Picker Menu (Only shows on tap) */}
            <div className={`flex items-center border-r pr-1 mr-1 ${isActive ? 'flex' : 'hidden md:flex'}`}>
              <div className="group/react relative">
                <button
                  onClick={(e) => { e.stopPropagation(); }}
                  className="p-1.5 hover:bg-muted rounded-md transition-colors text-foreground/70 hover:text-foreground md:hidden"
                  title="React"
                >
                  <SmilePlus className="w-4 h-4" />
                </button>
                <div className="hidden md:flex items-center md:static absolute bottom-full mb-2 md:mb-0 right-0 bg-background border shadow-md rounded-full p-1 gap-1 md:border-none md:shadow-none md:p-0 md:bg-transparent">
                  {EMOJI_OPTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={(e) => { e.stopPropagation(); handleToggleReaction(emoji); }}
                      className="w-7 h-7 flex items-center justify-center hover:bg-muted rounded-full transition-transform hover:scale-110 active:scale-95 text-base"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

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
