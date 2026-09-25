import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { 
  Send, 
  Paperclip, 
  X, 
  File as FileIcon,
  Loader2,
  Mic,
  Square,
  Trash2,
  Plus
} from 'lucide-react';
import { formatFileSize, validateFileSize } from '@/lib/utils';
import { DEFAULT_CONFIG } from '@/types';
import imageCompression from 'browser-image-compression';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useImageCompression } from '@/hooks/useImageCompression';
import { toast } from 'sonner';

const MAX_FILES = 5;

interface ChatInputProps {
  onSendMessage: (content: string, fileData?: any, ghostId?: string) => void;
  onUploadFile: (file: File, uploadId?: string) => Promise<any>;
  uploadProgress: { fileId?: string; progress: number; status: string; error?: string } | null;
  disabled?: boolean;
  droppedFiles?: File[] | null;
  onClearDroppedFiles?: () => void;
  droppedFile?: File | null;
  onClearDroppedFile?: () => void;
}

export function ChatInput({
  onSendMessage,
  onUploadFile,
  uploadProgress,
  disabled,
  droppedFiles,
  onClearDroppedFiles,
  droppedFile,
  onClearDroppedFile,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeUploads = useRef(new Set<string>());
  const pickerOpenRef = useRef(false);
  const { pausePing, resumePing, sendSuspend, sendResume, forceReconnect, suppressDisconnectUI } = useWebSocket();
  const { compressImages } = useImageCompression();

  // Preview URLs for staged images (cleaned up automatically when files change/unmount)
  useEffect(() => {
    const urls: Record<string, string> = {};
    selectedFiles.forEach((file, index) => {
      if (file.type.startsWith('image/')) {
        urls[`${file.name}-${file.size}-${index}`] = URL.createObjectURL(file);
      }
    });
    setPreviewUrls(urls);

    return () => {
      Object.values(urls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [selectedFiles]);

  const addFiles = useCallback((incomingFiles: FileList | File[]) => {
    const filesArray = Array.from(incomingFiles);
    if (filesArray.length === 0) return;

    setSelectedFiles((prev) => {
      const currentCount = prev.length;
      const availableSlots = MAX_FILES - currentCount;

      if (availableSlots <= 0) {
        toast.warning(`Maximum ${MAX_FILES} files can be attached at once`);
        return prev;
      }

      let filesToAdd = filesArray;
      if (filesArray.length > availableSlots) {
        toast.warning(`Maximum ${MAX_FILES} files allowed. Adding first ${availableSlots} file${availableSlots > 1 ? 's' : ''}.`);
        filesToAdd = filesArray.slice(0, availableSlots);
      }

      const validFiles: File[] = [];
      for (const file of filesToAdd) {
        if (!validateFileSize(file, DEFAULT_CONFIG.maxFileSize)) {
          toast.error(`"${file.name}" exceeds ${formatFileSize(DEFAULT_CONFIG.maxFileSize)} limit`);
        } else {
          validFiles.push(file);
        }
      }

      if (validFiles.length > 0) {
        toast.success(`Attached ${validFiles.length} file${validFiles.length > 1 ? 's' : ''}`);
      }

      return [...prev, ...validFiles];
    });

    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  // Sync dropped files from parent container (drag & drop)
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0) {
      addFiles(droppedFiles);
      onClearDroppedFiles?.();
    }
  }, [droppedFiles, addFiles, onClearDroppedFiles]);

  useEffect(() => {
    if (droppedFile) {
      addFiles([droppedFile]);
      onClearDroppedFile?.();
    }
  }, [droppedFile, addFiles, onClearDroppedFile]);

  // Clipboard Paste support (e.g. Ctrl+V screenshots or copied files)
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToPaste: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          let finalFile = file;
          if (!file.name || file.name === 'image.png') {
            const ext = file.type.split('/')[1] || 'png';
            finalFile = new File(
              [file],
              `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}-${i + 1}.${ext}`,
              { type: file.type }
            );
          }
          filesToPaste.push(finalFile);
        }
      }
    }

    if (filesToPaste.length > 0) {
      e.preventDefault();
      addFiles(filesToPaste);
    }
  }, [addFiles]);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleSend = useCallback(async () => {
    if (!message.trim() && selectedFiles.length === 0) return;

    const currentMessage = message.trim();
    const filesToSend = [...selectedFiles];
    
    // Clear input state immediately for instant UX perception
    setMessage('');
    setSelectedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    if (filesToSend.length === 0) {
      onSendMessage(currentMessage);
      return;
    }

    // ─── 1. Core Upload Compression & Multi-File Pipeline ───────────────────────
    setIsUploading(true);
    let messageAttached = false;

    for (let i = 0; i < filesToSend.length; i++) {
      const currentFile = filesToSend[i];
      const uploadId = crypto.randomUUID();

      if (activeUploads.current.has(uploadId)) continue;
      activeUploads.current.add(uploadId);

      setUploadStatusText(
        filesToSend.length > 1
          ? `Uploading file ${i + 1} of ${filesToSend.length}: "${currentFile.name}"...`
          : `Uploading "${currentFile.name}"...`
      );

      try {
        let fileToUpload = currentFile;
        // Smart Image Compression
        if (compressImages && currentFile.type.startsWith('image/')) {
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
        
        const fileData = await onUploadFile(fileToUpload, uploadId);

        if (fileData) {
          const caption = !messageAttached ? currentMessage : '';
          onSendMessage(caption, fileData, uploadId);
          messageAttached = true;
        }
      } catch (err: any) {
        console.error(`File upload failed for "${currentFile.name}":`, err);
        toast.error(`Failed to upload "${currentFile.name}"`);
      } finally {
        activeUploads.current.delete(uploadId);
      }
    }

    // If text message wasn't attached because all file uploads failed, send text message alone
    if (!messageAttached && currentMessage) {
      onSendMessage(currentMessage);
    }

    setIsUploading(false);
    setUploadStatusText(null);
  }, [message, selectedFiles, compressImages, onSendMessage, onUploadFile]);

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
    sendSuspend(); // Tell server to skip heartbeat checks for us
    fileInputRef.current?.click();
  }, [pausePing, sendSuspend, suppressDisconnectUI]);

  // ─── ANDROID FIX: Window focus recovery ──────────────────────────────────
  useEffect(() => {
    const handleWindowFocus = () => {
      if (!pickerOpenRef.current) return;

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
        sendResume(); // Tell server to resume heartbeat checks
        forceReconnect();
      }, 300);
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [resumePing, sendResume, forceReconnect, suppressDisconnectUI]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (focusTimeoutRef.current) clearTimeout(focusTimeoutRef.current);
    
    pickerOpenRef.current = false;
    suppressDisconnectUI.current = false;
    resumePing();
    sendResume(); // Tell server to resume heartbeat checks
    
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    e.target.value = '';
  }, [addFiles, resumePing, sendResume, suppressDisconnectUI]);

  const handleRemoveFile = useCallback((indexToRemove: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleClearAllFiles = useCallback(() => {
    setSelectedFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClearDroppedFiles?.();
    onClearDroppedFile?.();
  }, [onClearDroppedFiles, onClearDroppedFile]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `Voice-Note-${new Date().toLocaleTimeString().replace(/:/g,'-')}.webm`, { type: 'audio/webm' });
        addFiles([audioFile]);
        audioChunksRef.current = [];
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Microphone access is required to record voice notes.");
    }
  };

  const stopRecording = (cancel = false) => {
    if (mediaRecorderRef.current && isRecording) {
      if (cancel) {
        mediaRecorderRef.current.onstop = null; // Prevent file creation if cancelled
        audioChunksRef.current = [];
      }
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    }
  };

  // Cleanup recording on unmount
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, []);

  const isDisabled = disabled || isUploading || (!message.trim() && selectedFiles.length === 0);

  return (
    <div
      className="border-t bg-background p-2.5 sm:p-4"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          e.stopPropagation();
          const files = e.dataTransfer.files;
          if (files && files.length > 0) {
            addFiles(files);
          }
        }
      }}
    >
      {/* Single File Staging Preview */}
      {selectedFiles.length === 1 && (
        <div className="mb-2.5 flex items-center gap-2.5 p-2 sm:p-2.5 bg-muted/80 border rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-150">
          {previewUrls[`${selectedFiles[0].name}-${selectedFiles[0].size}-0`] ? (
            <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-lg overflow-hidden border bg-background shrink-0 shadow-sm">
              <img
                src={previewUrls[`${selectedFiles[0].name}-${selectedFiles[0].size}-0`]}
                alt={selectedFiles[0].name}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-background border flex items-center justify-center shrink-0 shadow-sm text-primary">
              <FileIcon className="w-5 h-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm font-medium truncate">{selectedFiles[0].name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] sm:text-xs text-muted-foreground">
                {formatFileSize(selectedFiles[0].size)}
              </span>
              <span className="text-[9px] sm:text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded bg-background border text-muted-foreground">
                1 of {MAX_FILES} attached
              </span>
            </div>
          </div>
          {isUploading ? (
            <div className="flex items-center gap-2 pr-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-xs font-medium">Uploading...</span>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
              onClick={() => handleRemoveFile(0)}
              title="Remove file"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}

      {/* Multiple Files Staging Preview (2 to 5 files) */}
      {selectedFiles.length > 1 && (
        <div className="mb-2.5 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <span>Attached files</span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">
                {selectedFiles.length}/{MAX_FILES}
              </span>
            </span>
            {!isUploading && (
              <button
                type="button"
                onClick={handleClearAllFiles}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors font-medium hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Horizontal scrollable row of compact chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-0.5 px-0.5 scrollbar-thin">
            {selectedFiles.map((file, idx) => {
              const previewUrl = previewUrls[`${file.name}-${file.size}-${idx}`];
              return (
                <div
                  key={`${file.name}-${file.size}-${idx}`}
                  className="flex items-center gap-2 p-1.5 pr-2 bg-muted/80 border rounded-xl shrink-0 max-w-[170px] sm:max-w-[200px] shadow-sm relative group"
                >
                  {previewUrl ? (
                    <div className="relative w-9 h-9 rounded-lg overflow-hidden border bg-background shrink-0">
                      <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-background border flex items-center justify-center shrink-0 text-primary">
                      <FileIcon className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  {!isUploading && (
                    <button
                      type="button"
                      className="h-5 w-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => handleRemoveFile(idx)}
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}

            {/* Add more button if slots remaining */}
            {selectedFiles.length < MAX_FILES && !isUploading && (
              <button
                type="button"
                onClick={openFilePicker}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed rounded-xl bg-background/50 hover:bg-muted/60 text-muted-foreground hover:text-foreground text-xs font-medium shrink-0 transition-colors h-11"
                title={`Add more files (${MAX_FILES - selectedFiles.length} slots left)`}
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                <span>Add ({MAX_FILES - selectedFiles.length} left)</span>
              </button>
            )}
          </div>
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
          disabled={disabled || isUploading || selectedFiles.length >= MAX_FILES}
          title={
            selectedFiles.length >= MAX_FILES
              ? `Maximum ${MAX_FILES} files reached`
              : `Attach files (up to ${MAX_FILES})`
          }
        >
          <Paperclip className="w-5 h-5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />

        {/* Message Input or Recording UI */}
        <div className="flex-1 relative border rounded-md bg-background flex items-center shadow-sm overflow-hidden">
          {isRecording ? (
            <div className="flex-1 min-h-[40px] flex items-center justify-between px-3 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center gap-3 text-destructive">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive animate-pulse" />
                <span className="font-mono text-sm tracking-widest">{new Date(recordingTime * 1000).toISOString().substring(14, 19)}</span>
              </div>
              <span className="text-sm font-medium animate-pulse opacity-70">Recording...</span>
            </div>
          ) : (
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Type a message..."
              className="min-h-[40px] max-h-[120px] resize-none py-2 px-3 border-0 focus-visible:ring-0 shadow-none text-sm leading-snug"
              disabled={disabled || isUploading || isRecording}
              rows={1}
            />
          )}
        </div>

        {/* Action Button: Cancel Recording, Send, or Mic */}
        {isRecording ? (
          <>
            <Button
              variant="outline"
              className="flex-shrink-0 h-10 w-10 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => stopRecording(true)}
              disabled={disabled || isUploading}
              title="Cancel recording"
            >
              <Trash2 className="w-5 h-5" />
            </Button>
            <Button
              className="flex-shrink-0 h-10 w-10"
              onClick={() => stopRecording(false)}
              disabled={disabled || isUploading}
              title="Stop and attach"
            >
              <Square className="w-4 h-4 fill-current" />
            </Button>
          </>
        ) : (!message.trim() && selectedFiles.length === 0) ? (
          <Button
            variant="secondary"
            className="flex-shrink-0 h-10 w-10"
            onClick={startRecording}
            disabled={disabled || isUploading}
            title="Record Voice Note"
          >
            <Mic className="w-5 h-5" />
          </Button>
        ) : (
          <Button
            className="flex-shrink-0 h-10 w-10"
            onClick={handleSend}
            disabled={isDisabled || isUploading || isRecording}
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        )}
      </div>

      {/* Upload Progress Status */}
      {isUploading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-primary font-medium animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>
            {uploadStatusText || 'Uploading...'}
            {uploadProgress && uploadProgress.status === 'uploading' ? ` (${uploadProgress.progress}%)` : ''}
          </span>
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
