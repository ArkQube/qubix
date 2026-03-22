import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Zap,
  Shield,
  Clock,
  Users,
  FileUp,
  Lock,
  MessageSquare,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Eye
} from 'lucide-react';
import { motion } from 'framer-motion';

interface LandingPageProps {
  onEnterChat: () => void;
}

export function LandingPage({ onEnterChat }: LandingPageProps) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const features = [
    {
      icon: Shield,
      title: 'Anonymous',
      description: 'No registration required. Get a random username and start chatting instantly.',
    },
    {
      icon: Clock,
      title: 'Ephemeral',
      description: 'All messages automatically expire after 1 hour. No permanent records.',
    },
    {
      icon: Lock,
      title: 'Private Rooms',
      description: 'Create password-protected rooms for secure group conversations.',
    },
    {
      icon: FileUp,
      title: 'File Sharing',
      description: 'Share files up to 10MB with automatic expiration and CDN delivery.',
    },
    {
      icon: Zap,
      title: 'Real-Time',
      description: 'WebSocket-powered instant messaging with sub-100ms latency.',
    },
    {
      icon: Eye,
      title: 'No Tracking',
      description: 'We don\'t store personal data. Your privacy is our priority.',
    },
  ];

  const stats = [
    { value: '10MB', label: 'Max File Size' },
    { value: '1h', label: 'Message Lifetime' },
    { value: '12h', label: 'Room Lifetime' },
    { value: '<100ms', label: 'Latency' },
  ];

  return (
    <div className="min-h-[100dvh] w-full bg-background relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Gradient Orbs */}
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full opacity-20"
          style={{
            background: 'radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)',
            left: mousePosition.x - 300,
            top: mousePosition.y - 300,
          }}
          animate={{
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />

        {/* Grid Pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b bg-background/80 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center">
                <img src="/Qube.svg" alt="Logo" className="w-full h-full object-contain" />
              </div>
              <span className="font-bold text-xl">AQchat</span>
            </div>
            <nav className="hidden md:flex items-center gap-6">
              <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
              <a href="#security" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Security</a>
            </nav>
            <Button onClick={onEnterChat} className="gap-2">
              Start Chatting
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {/* Hero Section */}
        <section className="pt-20 pb-32 px-4">
          <div className="max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm mb-8">
                <Sparkles className="w-4 h-4" />
                <span>Version 2.0 — Large File Edition</span>
              </div>
            </motion.div>

            <motion.h1
              className="text-5xl md:text-7xl font-bold tracking-tight mb-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              Ephemeral Communication
              <br />
              <span className="text-primary">Without a Trace</span>
            </motion.h1>

            <motion.p
              className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              Real-time messaging that disappears. No accounts, no history, no worries.
              Share files up to 10MB with complete privacy.
            </motion.p>

            <motion.div
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Button size="lg" onClick={onEnterChat} className="gap-2 text-lg px-8">
                <MessageSquare className="w-5 h-5" />
                Enter Global Chat
              </Button>
              <Button size="lg" variant="outline" className="gap-2 text-lg px-8">
                <Users className="w-5 h-5" />
                Create Private Room
              </Button>
            </motion.div>

            {/* Stats */}
            <motion.div
              className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-primary">{stat.value}</div>
                  <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-24 bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Choose AQchat?</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Built for privacy-conscious users who need secure, temporary communication.
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <motion.div
                    key={index}
                    className="bg-background rounded-2xl p-6 border hover:border-primary/50 transition-colors"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-primary" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Get started in seconds. No complicated setup required.
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-8">
              {[
                { step: '01', title: 'Connect', desc: 'Open AQchat and get an anonymous username automatically' },
                { step: '02', title: 'Chat', desc: 'Join global chat or create a private room with a code' },
                { step: '03', title: 'Share', desc: 'Send messages and files up to 10MB instantly' },
                { step: '04', title: 'Disappear', desc: 'Everything automatically expires after the time limit' },
              ].map((item, index) => (
                <motion.div
                  key={index}
                  className="relative"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <div className="text-6xl font-bold text-primary/10 mb-4">{item.step}</div>
                  <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                  <p className="text-muted-foreground">{item.desc}</p>
                  {index < 3 && (
                    <div className="hidden md:block absolute top-8 right-0 w-full h-px bg-border" />
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Security Section */}
        <section id="security" className="py-24 bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold mb-6">Your Privacy Matters</h2>
                <p className="text-lg text-muted-foreground mb-8">
                  AQchat is built with privacy at its core. We don&apos;t track you, we don&apos;t store your data,
                  and we can&apos;t read your messages.
                </p>
                <ul className="space-y-4">
                  {[
                    'No account registration required',
                    'Messages expire automatically',
                    'Files deleted from CDN after expiration',
                    'No IP logging or tracking',
                    'Open source and auditable',
                  ].map((item, index) => (
                    <li key={index} className="flex items-center gap-3">
                      <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-primary/5 rounded-3xl transform rotate-3" />
                <div className="relative bg-background rounded-3xl p-8 border">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Shield className="w-6 h-6 text-green-500" />
                    </div>
                    <div>
                      <div className="font-semibold">Secure Connection</div>
                      <div className="text-sm text-muted-foreground">WSS Encrypted</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="text-sm">Message Storage</span>
                      <span className="text-sm font-medium text-green-500">None</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="text-sm">Personal Data</span>
                      <span className="text-sm font-medium text-green-500">None</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="text-sm">Tracking</span>
                      <span className="text-sm font-medium text-green-500">Disabled</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <span className="text-sm">Encryption</span>
                      <span className="text-sm font-medium text-green-500">TLS 1.3</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to Chat Privately?</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Join thousands of users who trust AQchat for their ephemeral communication needs.
            </p>
            <Button size="lg" onClick={onEnterChat} className="gap-2 text-lg px-8">
              <Zap className="w-5 h-5" />
              Start Chatting Now
            </Button>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t py-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 flex items-center justify-center">
                  <img src="/Qube.svg" alt="Logo" className="w-full h-full object-contain" />
                </div>
                <span className="font-semibold">AQchat</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Ephemeral Real-Time Communication Platform — Version 2.0
              </p>
              <div className="flex items-center gap-6 text-sm text-muted-foreground">
                <span>10MB Files</span>
                <span>1h Lifetime</span>
                <span>No Accounts</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
