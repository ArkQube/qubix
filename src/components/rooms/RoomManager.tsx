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
import { Plus, Lock, Users, LogOut, Copy, Check, Globe, Share2, Hash } from 'lucide-react';
import { validateRoomCode, validatePIN } from '@/lib/utils';
import { useWebSocket } from '@/contexts/WebSocketContext';

interface RoomManagerProps {
  currentRoom: { id: string; code: string; name?: string; hasPin?: boolean; expiresAt: number } | null;
  onCreateRoom: (name?: string, pin?: string) => void;
  onJoinRoom: (code: string, pin?: string) => void;
  onLeaveRoom: () => void;
}

export function RoomManager({ currentRoom, onCreateRoom, onJoinRoom, onLeaveRoom }: RoomManagerProps) {
  const { roomParticipants } = useWebSocket();
  const participantCount = currentRoom ? roomParticipants.length : 'Global';

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
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
        <div className="flex items-center gap-2">
          {currentRoom ? (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Lock className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm whitespace-nowrap">{currentRoom.name || `Room ${currentRoom.code}`}</span>
                  <span className="sm:hidden text-xs text-muted-foreground whitespace-nowrap px-1.5 py-0.5 bg-muted rounded-md flex items-center gap-1">
                    <Users className="w-3 h-3" /> {participantCount}
                  </span>
                  {currentRoom.hasPin && (
                    <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
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
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Globe className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
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

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1.5 flex-nowrap shrink-0">

          {/* Global Chat button — click to go back to global from a private room */}
          {currentRoom && (
            <Button
              variant="outline"
              size="sm"
              onClick={onLeaveRoom}
              className="gap-1.5"
            >
              <Globe className="w-4 h-4" />
              <span className="hidden sm:inline">Global Chat</span>
            </Button>
          )}

          {/* Create Private Room */}
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant={currentRoom ? 'ghost' : 'outline'} size="sm" className="h-8 gap-1.5 px-2.5">
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Create Room</span>
                <span className="sm:hidden text-xs">Create</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Private Room</DialogTitle>
                <DialogDescription>
                  Create a private room for secure conversations. Room expires in 12 hours.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="room-name">Room Name (optional)</Label>
                  <Input
                    id="room-name"
                    placeholder="My Private Room"
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
              <Button variant={currentRoom ? 'ghost' : 'default'} size="sm" className="h-8 gap-1.5 px-2.5">
                <Users className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Join Room</span>
                <span className="sm:hidden text-xs">Join</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join Private Room</DialogTitle>
                <DialogDescription>
                  Enter the room code to join a private conversation.
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

          {/* Share — only shown when inside a private room */}
          {currentRoom && (
            <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="default" size="sm" className="gap-1.5">
                  <Share2 className="w-4 h-4" />
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

          {/* Leave Room (destructive confirmation) */}
          {currentRoom && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onLeaveRoom}
              title="Leave room"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
