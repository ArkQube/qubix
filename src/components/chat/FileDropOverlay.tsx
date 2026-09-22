import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileType } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { DEFAULT_CONFIG } from '@/types';

interface FileDropOverlayProps {
  isVisible: boolean;
  targetName?: string;
  onDrop: (files: FileList) => void;
  onClose: () => void;
}

export function FileDropOverlay({ isVisible, targetName, onDrop, onClose }: FileDropOverlayProps) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      onClose();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      onDrop(e.dataTransfer.files);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="absolute inset-0 z-50 flex items-center justify-center p-6 bg-background/85 dark:bg-background/90 backdrop-blur-md cursor-copy select-none pointer-events-auto"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="w-full max-w-md p-8 rounded-2xl border-2 border-dashed border-primary/80 bg-primary/5 flex flex-col items-center justify-center text-center shadow-2xl relative overflow-hidden pointer-events-none">
            {/* Ambient background glow */}
            <div className="absolute -top-16 -left-16 w-32 h-32 bg-primary/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-16 -right-16 w-32 h-32 bg-primary/20 rounded-full blur-3xl" />

            {/* Pulsing Upload Icon */}
            <motion.div
              animate={{ y: [-4, 4, -4] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4 shadow-sm"
            >
              <UploadCloud className="w-9 h-9" />
            </motion.div>

            {/* Main Text */}
            <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
              Drop file to share
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Sending to <span className="font-semibold text-foreground">{targetName || 'Chat'}</span>
            </p>

            {/* File info pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/80 border text-xs font-medium text-muted-foreground shadow-sm">
              <FileType className="w-3.5 h-3.5 text-primary" />
              <span>Max size {formatFileSize(DEFAULT_CONFIG.maxFileSize)} • Images, Documents, Audio, Video</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
