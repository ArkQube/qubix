import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare,
  Settings,
  HelpCircle,
  Shield,
  Clock,
  Globe,
  Lock
} from 'lucide-react';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { DEFAULT_CONFIG } from '@/types';
import { formatFileSize, getTimeRemaining } from '@/lib/utils';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function AppSidebar({ activeTab, onTabChange }: SidebarProps) {
  const { currentUser, connected, currentRoom, activeSpace, switchSpace } = useWebSocket();

  const menuItems = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'help', label: 'Help', icon: HelpCircle },
  ];

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col h-full">
      {/* Text-Based SVG Logo */}
      <div className="p-5 border-b bg-gradient-to-b from-primary/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 flex items-center justify-center">
            <img src="/logo.svg" alt="Logo" className="w-full h-full object-contain" />
          </div>

          <div className="flex flex-col justify-center gap-0.5">
            <h1 className="font-bold text-[26px] tracking-tight leading-none text-foreground">AQchat</h1>
            <span className="text-[11px] text-primary font-bold uppercase tracking-[0.2em] leading-none">by arkqube</span>
          </div>
        </div>
      </div>

      {/* User Info */}
      {currentUser && (
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-medium">
              {currentUser.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{currentUser.username}</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-xs text-muted-foreground">
                  {connected ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant={activeTab === item.id ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-3"
                onClick={() => onTabChange(item.id)}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Button>
            );
          })}
        </div>

        {/* Current Room Info */}
        {currentRoom && (
          <div className="p-4 mt-4">
            <button
              onClick={() => {
                switchSpace('room');
                onTabChange('chat');
              }}
              className={`w-full text-left rounded-lg p-3 transition-colors border ${
                activeSpace === 'room'
                  ? 'bg-primary/10 border-primary/30 ring-1 ring-primary/20'
                  : 'bg-primary/5 hover:bg-primary/10 border-transparent cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">Private Room</span>
                </div>
                {activeSpace === 'room' && (
                  <span className="text-[10px] bg-primary/20 text-primary font-semibold px-1.5 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
              <p className="text-sm font-medium truncate">{currentRoom.name || `Room ${currentRoom.code}`}</p>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span>Expires in {getTimeRemaining(currentRoom.expiresAt)}</span>
              </div>
            </button>
          </div>
        )}
      </ScrollArea>

      {/* Footer Info */}
      <div className="p-4 border-t space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="w-4 h-4" />
          <span>End-to-end encrypted</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>Messages expire in 1 hour</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Globe className="w-4 h-4" />
          <span>Max file size: {formatFileSize(DEFAULT_CONFIG.maxFileSize)}</span>
        </div>
      </div>
    </div>
  );
}
