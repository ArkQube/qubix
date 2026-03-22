import { useState, useEffect } from 'react';

export function useImageCompression() {
  const [compressImages, setCompressAction] = useState<boolean>(() => {
    const stored = localStorage.getItem('arkion_compress_images');
    return stored ? JSON.parse(stored) : true;
  });

  const setCompressImages = (value: boolean) => {
    setCompressAction(value);
    localStorage.setItem('arkion_compress_images', JSON.stringify(value));
    window.dispatchEvent(new Event('image_compression_changed'));
  };

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('arkion_compress_images');
      if (stored !== null) {
        setCompressAction(JSON.parse(stored));
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('image_compression_changed', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('image_compression_changed', handleStorageChange);
    };
  }, []);

  return { compressImages, setCompressImages };
}
