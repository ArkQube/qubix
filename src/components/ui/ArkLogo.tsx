import type { ImgHTMLAttributes, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export interface ArkLogoProps extends ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
  size?: number | string;
}

/**
 * ArkLogo
 * Renders the modern isometric ARK cube mark with automatic dark/light mode adaptation.
 */
export function ArkLogo({ className, size, alt = 'ARK Logo', style, ...props }: ArkLogoProps) {
  const customStyle: CSSProperties = {
    ...style,
    ...(size ? { width: size, height: size } : {}),
  };

  return (
    <img
      src="/logo.svg"
      alt={alt}
      className={cn(
        'object-contain select-none pointer-events-none dark:invert transition-all duration-200',
        className
      )}
      style={customStyle}
      {...props}
    />
  );
}
