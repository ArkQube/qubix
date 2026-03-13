import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  Send, 
  Paperclip, 
  X, 
  File as FileIcon,
  Loader2
} from 'lucide-react';
import { formatFileSize, validateFileSize } from '@/lib/utils';
import { DEFAULT_CONFIG } from '@/types';
import imageCompression from 'browser-image-compression';
import { useWebSocket } from '@/contexts/WebSocketContext';

interface ChatInputProps {
  onSendMessage: (content: string, fileData?: any, ghostId?: string) => void;
  onUploadFile: (file: File, uploadId?: string) => Promise<any>;
  uploadProgress: { progress: number; status: string; error?: string } | null;
  disabled?: boolean;
}

export function ChatInput({ onSendMessage, onUploadFile, uploadProgress, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeUploads = useRef(new Set<string>());
  const pickerOpenRef = useRef(false);
  const { pausePing, resumePing, forceReconnect, suppressDisconnectUI } = useWebSocket();

  const handleSend = useCallback(async () => {
    if (!message.trim() && !selectedFile) return;

    const currentMessage = message;
    const currentFile = selectedFile;
    
    // Clear input state immediately for instant UX perception
    setMessage('');
    setSelectedFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    let fileData = null;
    let uploadId = undefined;

    // ─── 1. Core Upload Compression & UUID Pipeline ───────────────────────────
    if (currentFile) {
      uploadId = crypto.randomUUID();
      
      // Strict Deduplication — physically prevents 2x button taps generating 2 messages
      if (activeUploads.current.has(uploadId)) return; 
      activeUploads.current.add(uploadId);

      setIsUploading(true);

      try {
        let fileToUpload = currentFile;
        // Smart Image Compression
        if (currentFile.type.startsWith('image/')) {
          try {
            const compressedBlob = await imageCompression(currentFile, {
              maxSizeMB: 1,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
            });
            // Restore original filename (browser-image-compression often drops it)
            fileToUpload = new File([compressedBlob], currentFile.name, {
              type: compressedBlob.type,
              lastModified: Date.now(),
            });
          } catch (compressErr) {
            console.warn('Image compression failed, utilizing the raw original file blob', compressErr);
          }
        }
        
        fileData = await onUploadFile(fileToUpload, uploadId);
      } catch (err) {
        console.error('File upload failed inside HTTP stream:', err);
      } finally {
        activeUploads.current.delete(uploadId);
        setIsUploading(false);
      }
      
      // If the compression or Cloudinary HTTP proxy failed, abruptly abort the WS broadcast
      if (!fileData) return; 
    }

    // ─── 2. Final Message Broadcast ───────────────────────────────────────────
    onSendMessage(currentMessage, fileData, uploadId);
  }, [message, selectedFile, onSendMessage, onUploadFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Track when the picker was opened so we can distinguish spurious Android
  // focus events (fired immediately after input.click()) from real returns.
  const pickerOpenedAtRef = useRef<number>(0);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openFilePicker = useCallback(() => {
    // Suspend WS network pings while the Native OS File Modal forcefully blocks JS execution
    pickerOpenRef.current = true;
    pickerOpenedAtRef.current = Date.now();
    suppressDisconnectUI.current = true; // Don't show "Connection Lost" while picker is open
    pausePing();
    fileInputRef.current?.click();
  }, [pausePing, suppressDisconnectUI]);

  // ─── ANDROID FIX: Window focus recovery ──────────────────────────────────
  // PROBLEM 1 — Spurious focus: On some Android devices, calling
  //   `input.click()` causes the browser to briefly blur/refocus the window
  //   BEFORE the native picker appears. If we reconnect here, we kill the
  //   connection while the user hasn't even seen the picker yet.
  //
  // PROBLEM 2 — focus-before-change race: When the user picks a file and
  //   the picker closes, `focus` fires BEFORE the input's `change` event.
  //   If we `forceReconnect()` immediately, React disables the input and the
  //   `change` event never fires, dropping the file.
  //
  // FIX: Ignore focus events that arrive < 2 seconds after opening the
  // picker (these are spurious). For real returns, wait 300ms to let
  // `change` fire first. If `change` handles it, it cancels this timeout.
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!pickerOpenRef.current) return;

      // Guard: If the picker was opened < 2s ago, this is a spurious
      // Android focus event — the native picker hasn't even appeared yet.
      const elapsed = Date.now() - pickerOpenedAtRef.current;
      if (elapsed < 2000) {
        console.log(`[ChatInput] Ignoring spurious focus event (${elapsed}ms after open)`);
        return;
      }

      if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = setTimeout(() => {
        if (!pickerOpenRef.current) return; // Handled by onChange already
        
        console.log('[ChatInput] Picker closed/cancelled. Reconnecting...');
        pickerOpenRef.current = false;
        suppressDisconnectUI.current = false;
        resumePing();
        forceReconnect();
      }, 300);
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [resumePing, forceReconnect]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    
    // We captured the file! Now we can safely trigger the reconnect.
    pickerOpenRef.current = false;
    suppressDisconnectUI.current = false;
    resumePing();
    // Only force reconnect if the picker was open long enough to have
    // potentially killed the socket (> 5 seconds of OS suspension).
    const elapsed = Date.now() - pickerOpenedAtRef.current;
    if (elapsed > 5000) {
      forceReconnect();
    }
    
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileSize(file, DEFAULT_CONFIG.maxFileSize)) {
      alert(`File size exceeds ${formatFileSize(DEFAULT_CONFIG.maxFileSize)} limit`);
      return;
    }

    setSelectedFile(file);
  }, [resumePing, forceReconnect]);

  const handleRemoveFile = useCallback(() => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, []);

  const isDisabled = disabled || isUploading || (!message.trim() && !selectedFile);

  return (
    <div className="border-t bg-background p-4">
      {/* Selected File Preview */}
      {selectedFile && (
        <div className="mb-3 flex items-center gap-3 p-3 bg-muted rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center">
            <FileIcon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(selectedFile.size)}
            </p>
          </div>
          {isUploading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">Uploading...</span>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRemoveFile}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2">
        {/* File Attachment Button */}
        <Button
          variant="outline"
          size="icon"
          className="flex-shrink-0 h-10 w-10"
          onClick={openFilePicker}
          disabled={disabled || isUploading || !!selectedFile}
        >
          <Paperclip className="w-5 h-5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />

        {/* Message Input */}
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-[120px] resize-none pr-12 py-3"
            disabled={disabled || isUploading}
            rows={1}
          />
        </div>

        {/* Send Button */}
        <Button
          className="flex-shrink-0 h-10 w-10"
          onClick={handleSend}
          disabled={isDisabled}
        >
          {isUploading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </div>

      {/* Upload Progress */}
      {uploadProgress && uploadProgress.status === 'uploading' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Uploading... {uploadProgress.progress}%</span>
        </div>
      )}

      {/* Upload Error */}
      {uploadProgress && uploadProgress.status === 'error' && (
        <div className="mt-2 text-xs text-destructive">
          Upload failed: {uploadProgress.error}
        </div>
      )}
    </div>
  );
}
