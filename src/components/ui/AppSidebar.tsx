import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare,
  Settings,
  HelpCircle,
  Shield,
  Clock,
  Globe,
  Lock,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { DEFAULT_CONFIG } from '@/types';
import { formatFileSize, getTimeRemaining } from '@/lib/utils';
import { ArkLogo } from './ArkLogo';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function AppSidebar({ activeTab, onTabChange }: SidebarProps) {
  const { currentUser, connected, joinedRooms, unreadCounts, activeSpace, switchSpace } = useWebSocket();

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
            <ArkLogo className="w-full h-full" />
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

        {/* Joined Rooms Section */}
        {joinedRooms.length > 0 && (
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                Joined Rooms ({joinedRooms.length})
              </span>
            </div>
            <div className="space-y-1">
              {/* Global Chat Item */}
              <button
                onClick={() => {
                  switchSpace('global');
                  onTabChange('chat');
                }}
                className={`w-full text-left rounded-md px-2.5 py-1.5 transition-colors flex items-center justify-between text-xs ${
                  activeSpace === 'global' && activeTab === 'chat'
                    ? 'bg-primary/10 text-primary font-medium border border-primary/20'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">Global Chat</span>
                </div>
                {unreadCounts['global'] ? (
                  <Badge variant="destructive" className="h-4 px-1 text-[10px] min-w-4 flex items-center justify-center">
                    {unreadCounts['global']}
                  </Badge>
                ) : activeSpace === 'global' && activeTab === 'chat' ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                ) : null}
              </button>

              {/* Each Joined Room */}
              {joinedRooms.map((room) => {
                const isActive = activeSpace === room.id && activeTab === 'chat';
                const unread = unreadCounts[room.id] || 0;
                return (
                  <button
                    key={room.id}
                    onClick={() => {
                      switchSpace(room.id);
                      onTabChange('chat');
                    }}
                    className={`w-full text-left rounded-md px-2.5 py-2 transition-colors border cursor-pointer ${
                      isActive
                        ? 'bg-primary/10 text-primary border-primary/30 ring-1 ring-primary/20'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0 font-medium text-xs text-foreground truncate">
                        <Lock className="w-3 h-3 text-primary flex-shrink-0" />
                        <span className="truncate">{room.name || `Room ${room.code}`}</span>
                      </div>
                      {unread > 0 ? (
                        <Badge variant="destructive" className="h-4 px-1 text-[10px] min-w-4 flex items-center justify-center">
                          {unread}
                        </Badge>
                      ) : isActive ? (
                        <span className="text-[9px] bg-primary/20 text-primary font-bold px-1 py-0.2 rounded">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="font-mono">{room.code}</span>
                      <span>{getTimeRemaining(room.expiresAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
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
