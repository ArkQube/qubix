import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Lock, Users, LogOut, Copy, Check, Globe, Share2, Hash, ChevronDown, Layers } from 'lucide-react';
import { validateRoomCode, validatePIN } from '@/lib/utils';
import { useWebSocket } from '@/contexts/WebSocketContext';
import type { Room } from '@/types';

interface RoomManagerProps {
  currentRoom: Room | null;
  joinedRooms?: Room[];
  activeSpace: string; // 'global' or roomId
  onSwitchSpace: (space: string) => void;
  onCreateRoom: (name?: string, pin?: string) => void;
  onJoinRoom: (code: string, pin?: string) => void;
  onLeaveRoom: (roomId?: string) => void;
  unreadCounts?: Record<string, number>;
}

export function RoomManager({
  currentRoom,
  joinedRooms = [],
  activeSpace,
  onSwitchSpace,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  unreadCounts = {},
}: RoomManagerProps) {
  const { roomParticipants } = useWebSocket();
  const participantCount = (activeSpace !== 'global' && currentRoom) ? roomParticipants.length : 'Global';

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [usePin, setUsePin] = useState(false);
  const [roomPin, setRoomPin] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPin, setJoinPin] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [error, setError] = useState('');

  const handleCreateRoom = () => {
    setError('');
    if (usePin && !validatePIN(roomPin)) {
      setError('PIN must be 4 digits');
      return;
    }
    onCreateRoom(roomName || undefined, usePin ? roomPin : undefined);
    setCreateDialogOpen(false);
    setRoomName('');
    setRoomPin('');
    setUsePin(false);
  };

  const handleJoinRoom = () => {
    setError('');
    const upperCode = joinCode.toUpperCase();
    if (!validateRoomCode(upperCode)) {
      setError('Invalid room code. Must be 5 characters.');
      return;
    }
    onJoinRoom(upperCode, joinPin || undefined);
    setJoinDialogOpen(false);
    setJoinCode('');
    setJoinPin('');
  };

  const copyRoomCode = () => {
    if (currentRoom) {
      navigator.clipboard.writeText(currentRoom.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyShareLink = () => {
    if (currentRoom) {
      const link = `${window.location.origin}?room=${currentRoom.code}`;
      navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
      <div className="px-3 py-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">

        {/* Left: Mode indicator */}
        <div className="flex items-center gap-2 min-w-0">
          {activeSpace !== 'global' && currentRoom ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{currentRoom.name || `Room ${currentRoom.code}`}</span>
                  <span className="sm:hidden text-xs text-muted-foreground whitespace-nowrap px-1.5 py-0.5 bg-muted rounded-md flex items-center gap-1">
                    <Users className="w-3 h-3" /> {participantCount}
                  </span>
                  {currentRoom.hasPin && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5 shrink-0">
                      <Lock className="w-3 h-3 mr-1" />PIN
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Hash className="w-3 h-3" />
                  <span className="font-mono tracking-wider">{currentRoom.code}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Globe className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm whitespace-nowrap">Global Chat</span>
                  <span className="sm:hidden text-xs text-muted-foreground whitespace-nowrap px-1.5 py-0.5 bg-muted/50 rounded-md flex items-center gap-1">
                    <Users className="w-3 h-3" /> {participantCount}
                  </span>
                </div>
                <p className="hidden sm:block text-xs text-muted-foreground">Public · Messages expire in 1 hour</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Action buttons & Room Switcher */}
        <div className="flex items-center gap-1.5 flex-nowrap shrink-0">

          {/* Switch to Global Chat button (when currently in a room) */}
          {activeSpace !== 'global' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitchSpace('global')}
              className="gap-1.5 h-8 px-2.5"
              title="Switch to Global Chat"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Global Chat</span>
            </Button>
          )}

          {/* If viewing Global Chat and user has 1 joined room: Quick Return Button */}
          {activeSpace === 'global' && joinedRooms.length === 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitchSpace(joinedRooms[0].id)}
              className="gap-1.5 h-8 px-2.5 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary font-medium"
              title={`Return to ${joinedRooms[0].name || joinedRooms[0].code}`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Back to {joinedRooms[0].name || joinedRooms[0].code}</span>
              <span className="sm:hidden text-xs font-mono">{joinedRooms[0].code}</span>
            </Button>
          )}

          {/* Multi-Room Switcher Dropdown (when user has multiple rooms) */}
          {joinedRooms.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 px-2.5 relative border-primary/30"
                  title="Switch between your joined rooms"
                >
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">Rooms ({joinedRooms.length})</span>
                  <span className="sm:hidden text-xs font-semibold">{joinedRooms.length}</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />

                  {/* Overall unread indicator on rooms menu */}
                  {Object.values(unreadCounts).some(c => c > 0) && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-destructive rounded-full animate-pulse" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center justify-between">
                  <span>My Enrolled Rooms</span>
                  <Badge variant="outline" className="text-[10px]">{joinedRooms.length}</Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Global Chat Item */}
                <DropdownMenuItem
                  onClick={() => onSwitchSpace('global')}
                  className={`flex items-center justify-between cursor-pointer ${
                    activeSpace === 'global' ? 'bg-primary/10 font-semibold' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    <span>Global Chat</span>
                  </div>
                  {activeSpace === 'global' && (
                    <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">Active</span>
                  )}
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Rooms List */}
                {joinedRooms.map(room => {
                  const isActive = activeSpace === room.id;
                  const unread = unreadCounts[room.id] || 0;
                  return (
                    <DropdownMenuItem
                      key={room.id}
                      onClick={() => onSwitchSpace(room.id)}
                      className={`flex items-center justify-between cursor-pointer ${
                        isActive ? 'bg-primary/10 font-semibold' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {room.hasPin ? (
                          <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
                        ) : (
                          <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate text-xs">{room.name || `Room ${room.code}`}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {unread > 0 && (
                          <span className="bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                            {unread}
                          </span>
                        )}
                        {isActive && (
                          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">Active</span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Create Private Room */}
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5">
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Create Room</span>
                <span className="sm:hidden text-xs">Create</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Private Room</DialogTitle>
                <DialogDescription>
                  Create a new private room for secure conversations. You can create multiple rooms. Rooms expire in 12 hours.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="room-name">Room Name (optional)</Label>
                  <Input
                    id="room-name"
                    placeholder="e.g. Project Ark, Team Chat"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="use-pin">Require PIN</Label>
                  <Switch id="use-pin" checked={usePin} onCheckedChange={setUsePin} />
                </div>
                {usePin && (
                  <div className="space-y-2">
                    <Label htmlFor="room-pin">4-Digit PIN</Label>
                    <Input
                      id="room-pin"
                      type="password"
                      placeholder="0000"
                      maxLength={4}
                      value={roomPin}
                      onChange={(e) => setRoomPin(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateRoom}>Create Room</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Join Room */}
          <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="default" size="sm" className="h-8 gap-1.5 px-2.5">
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Join Room</span>
                <span className="sm:hidden text-xs">Join</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join Private Room</DialogTitle>
                <DialogDescription>
                  Enter the 5-letter room code to join. You can stay enrolled in multiple rooms at the same time.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="join-code">Room Code</Label>
                  <Input
                    id="join-code"
                    placeholder="ABC12"
                    maxLength={5}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    className="font-mono tracking-wider text-lg"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="join-pin">PIN (if required)</Label>
                  <Input
                    id="join-pin"
                    type="password"
                    placeholder="0000"
                    maxLength={4}
                    value={joinPin}
                    onChange={(e) => setJoinPin(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setJoinDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleJoinRoom}>Join Room</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Share — only shown when currently inside a private room */}
          {activeSpace !== 'global' && currentRoom && (
            <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 h-8 px-2.5">
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Share Room</DialogTitle>
                  <DialogDescription>
                    Share the room code or invite link so others can join this private room.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Room Code</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-2xl tracking-[0.4em] text-center font-bold">
                        {currentRoom.code}
                      </div>
                      <Button variant="outline" size="icon" onClick={copyRoomCode}>
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">Share this code with anyone you want to invite</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Invite Link</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs text-muted-foreground truncate font-mono">
                        {window.location.origin}?room={currentRoom.code}
                      </div>
                      <Button variant="outline" size="icon" onClick={copyShareLink}>
                        {copiedLink ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {currentRoom.hasPin && (
                    <div className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                      <Lock className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-yellow-700 dark:text-yellow-400">
                        This room requires a PIN. Share the PIN separately through a secure channel.
                      </p>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={() => setShareDialogOpen(false)}>Done</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          {/* Leave Room (destructive confirmation modal for active room) */}
          {activeSpace !== 'global' && currentRoom && (
            <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Leave room"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Leave Room?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to leave <span className="font-semibold text-foreground">"{currentRoom.name || currentRoom.code}"</span>? You will need the room code and PIN to rejoin. Any other rooms you have joined will stay open.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      onLeaveRoom(currentRoom.id);
                      setLeaveDialogOpen(false);
                    }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Leave Room
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </div>
  );
}
