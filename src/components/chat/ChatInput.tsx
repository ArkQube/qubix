import { useState, useRef, useCallback } from 'react';
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

interface ChatInputProps {
  onSendMessage: (content: string, fileData?: any) => void;
  onUploadFile: (file: File) => Promise<any>;
  uploadProgress: { progress: number; status: string; error?: string } | null;
  disabled?: boolean;
}

export function ChatInput({ onSendMessage, onUploadFile, uploadProgress, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (!message.trim() && !selectedFile) return;

    let fileData = null;

    // Upload file if selected
    if (selectedFile) {
      setIsUploading(true);
      try {
        fileData = await onUploadFile(selectedFile);
      } catch (err) {
        console.error('File upload failed:', err);
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
      setSelectedFile(null);
    }

    // Send message
    onSendMessage(message, fileData);
    setMessage('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [message, selectedFile, onSendMessage, onUploadFile]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!validateFileSize(file, DEFAULT_CONFIG.maxFileSize)) {
      alert(`File size exceeds ${formatFileSize(DEFAULT_CONFIG.maxFileSize)} limit`);
      return;
    }

    setSelectedFile(file);
  }, []);

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
          onClick={() => fileInputRef.current?.click()}
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
