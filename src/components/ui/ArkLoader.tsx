import { cn } from '@/lib/utils';
import { ArkLogo } from './ArkLogo';

export interface ArkLoaderProps {
  /** Size preset or pixel number */
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  /** Primary status label displayed below loader */
  label?: string;
  /** Secondary status caption */
  sublabel?: string;
  /** Animation style variant */
  variant?: '3d-spin' | 'orbital' | 'pulse';
  /** Show rotating outer cyber-ring */
  showRing?: boolean;
  /** Fill the entire screen as a centered backdrop overlay */
  fullscreen?: boolean;
  /** Custom container class */
  className?: string;
}

const SIZE_MAP = {
  sm: { cube: 32, ring: 52, text: 'text-xs', glow: 'w-8 h-2' },
  md: { cube: 52, ring: 80, text: 'text-sm', glow: 'w-12 h-3' },
  lg: { cube: 76, ring: 114, text: 'text-base', glow: 'w-16 h-4' },
  xl: { cube: 104, ring: 154, text: 'text-lg', glow: 'w-24 h-5' },
};

/**
 * ArkLoader
 * Premium 3D animated rotating ARK cube loading component.
 * Can be used as a full-page connecting screen, inline card loader, or button spinner.
 */
export function ArkLoader({
  size = 'md',
  label,
  sublabel,
  variant = '3d-spin',
  showRing = true,
  fullscreen = false,
  className,
}: ArkLoaderProps) {
  const sizeConfig = typeof size === 'number'
    ? {
        cube: size,
        ring: Math.round(size * 1.5),
        text: size < 40 ? 'text-xs' : size < 70 ? 'text-sm' : 'text-base',
        glow: `w-[${Math.round(size * 0.9)}px] h-3`,
      }
    : SIZE_MAP[size];

  const content = (
    <div className={cn('flex flex-col items-center justify-center select-none', className)}>
      <style>{`
        @keyframes ark-spin-3d {
          0% {
            transform: perspective(800px) rotateX(16deg) rotateY(0deg) translateY(0px);
          }
          25% {
            transform: perspective(800px) rotateX(0deg) rotateY(90deg) translateY(-6px);
          }
          50% {
            transform: perspective(800px) rotateX(-16deg) rotateY(180deg) translateY(0px);
          }
          75% {
            transform: perspective(800px) rotateX(0deg) rotateY(270deg) translateY(-6px);
          }
          100% {
            transform: perspective(800px) rotateX(16deg) rotateY(360deg) translateY(0px);
          }
        }

        @keyframes ark-ring-orbit {
          0% {
            transform: rotateX(68deg) rotateZ(0deg);
          }
          100% {
            transform: rotateX(68deg) rotateZ(360deg);
          }
        }

        @keyframes ark-glow-pulse {
          0%, 100% {
            opacity: 0.3;
            transform: scale(0.85);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.2);
          }
        }

        @keyframes ark-dot-fade {
          0%, 20% { opacity: 0; }
          40% { opacity: 1; }
          100% { opacity: 0; }
        }

        .animate-ark-cube {
          animation: ark-spin-3d 3.2s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
          transform-style: preserve-3d;
          will-change: transform;
        }

        .animate-ark-ring {
          animation: ark-ring-orbit 4s linear infinite;
          transform-style: preserve-3d;
          will-change: transform;
        }

        .animate-ark-glow {
          animation: ark-glow-pulse 3.2s ease-in-out infinite;
        }

        .ark-dot-1 { animation: ark-dot-fade 1.4s infinite 0.2s; }
        .ark-dot-2 { animation: ark-dot-fade 1.4s infinite 0.4s; }
        .ark-dot-3 { animation: ark-dot-fade 1.4s infinite 0.6s; }
      `}</style>

      {/* 3D Scene Container */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: sizeConfig.ring,
          height: sizeConfig.ring,
        }}
      >
        {/* Orbital Cyber Ring */}
        {showRing && variant !== 'pulse' && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ perspective: 800 }}
          >
            <div
              className="animate-ark-ring rounded-full border border-dashed border-primary/40 dark:border-primary/50"
              style={{
                width: sizeConfig.ring,
                height: sizeConfig.ring,
                boxShadow: '0 0 16px rgba(var(--primary), 0.15)',
              }}
            />
          </div>
        )}

        {/* Floating Rotating ARK Cube */}
        <div
          className={cn(
            'relative z-10 flex items-center justify-center',
            variant === '3d-spin' && 'animate-ark-cube',
            variant === 'pulse' && 'animate-pulse'
          )}
          style={{
            width: sizeConfig.cube,
            height: sizeConfig.cube,
          }}
        >
          <ArkLogo
            size={sizeConfig.cube}
            className="w-full h-full filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:drop-shadow-[0_0_16px_rgba(255,255,255,0.25)]"
          />
        </div>

        {/* Ambient Ground Glow & Reflection */}
        <div
          className={cn(
            'absolute bottom-2 rounded-full bg-primary/20 dark:bg-primary/30 blur-md pointer-events-none animate-ark-glow',
            sizeConfig.glow
          )}
        />
      </div>

      {/* Labels */}
      {label && (
        <div className="mt-4 text-center">
          <p className={cn('font-semibold tracking-tight text-foreground flex items-center justify-center', sizeConfig.text)}>
            <span>{label}</span>
            <span className="inline-flex tracking-widest ml-0.5">
              <span className="ark-dot-1">.</span>
              <span className="ark-dot-2">.</span>
              <span className="ark-dot-3">.</span>
            </span>
          </p>
          {sublabel && (
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">{sublabel}</p>
          )}
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md">
        {content}
      </div>
    );
  }

  return content;
}
