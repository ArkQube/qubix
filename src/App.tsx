import { useState } from 'react';
import { WebSocketProvider, useWebSocket } from '@/contexts/WebSocketContext';
import { LandingPage } from '@/components/ui/LandingPage';
import { AppSidebar } from '@/components/ui/AppSidebar';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { SettingsView } from '@/components/settings/SettingsView';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { Hexagon } from 'lucide-react';
import './App.css';

function AppContent() {
  const [showLanding, setShowLanding] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const { connected } = useWebSocket();

  const handleEnterChat = () => {
    setShowLanding(false);
  };

  if (showLanding) {
    return <LandingPage onEnterChat={handleEnterChat} />;
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex h-full">
        <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header (Only visible on small screens) */}
        <div className="md:hidden flex items-center justify-between p-4 border-b bg-background shadow-sm z-10 relative">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" className="p-1 -ml-2 hover:bg-transparent flex items-center gap-3 active:scale-95 transition-transform">
                <div className="flex items-center gap-3 bg-gradient-to-r from-primary/10 to-transparent p-1.5 pr-4 rounded-xl">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                    <Hexagon className="w-5 h-5 text-primary-foreground fill-primary-foreground/20" />
                  </div>

                  {/* Typography Branding */}
                  <div className="flex flex-col items-start leading-none gap-0.5">
                    <h1 className="font-bold text-[22px] text-foreground tracking-tight">Arkion</h1>
                    <span className="text-[10px] text-primary font-bold uppercase tracking-[0.2em]">by arkqube</span>
                  </div>
                </div>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <SheetDescription className="sr-only">Access Chat, Rooms, and Settings</SheetDescription>
              <SheetClose asChild>
                <div className="h-full flex flex-col">
                  <AppSidebar
                    activeTab={activeTab}
                    onTabChange={(tab) => {
                      setActiveTab(tab);
                    }}
                  />
                </div>
              </SheetClose>
            </SheetContent>
          </Sheet>

          {/* Mobile Connection Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            </span>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {connected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {activeTab === 'chat' && <ChatContainer />}
            {activeTab === 'rooms' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-2">Rooms</h2>
                  <p className="text-muted-foreground">Use the chat to create or join rooms</p>
                </div>
              </div>
            )}
            {activeTab === 'settings' && <SettingsView />}
            {activeTab === 'help' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-md px-4">
                  <h2 className="text-2xl font-bold mb-4">Help & FAQ</h2>
                  <div className="space-y-4 text-left">
                    <div className="p-4 bg-muted rounded-lg">
                      <h3 className="font-semibold mb-2">How do private rooms work?</h3>
                      <p className="text-sm text-muted-foreground">
                        Create a room and share the 5-character code with others.
                        You can optionally add a PIN for extra security.
                      </p>
                    </div>
                    <div className="p-4 bg-muted rounded-lg">
                      <h3 className="font-semibold mb-2">When do messages expire?</h3>
                      <p className="text-sm text-muted-foreground">
                        Global chat messages expire after 1 hour. Private room messages expire after 12 hours.
                      </p>
                    </div>
                    <div className="p-4 bg-muted rounded-lg">
                      <h3 className="font-semibold mb-2">What file types are supported?</h3>
                      <p className="text-sm text-muted-foreground">
                        Most file types are supported up to 10MB. Files expire after 1 hour.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main >
    </div >
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <WebSocketProvider>
        <AppContent />
        <Toaster position="top-right" />
      </WebSocketProvider>
    </ThemeProvider>
  );
}

export default App;
