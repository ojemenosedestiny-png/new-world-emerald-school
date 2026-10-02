import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from "@/lib/asset";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useScroll, useSpring } from 'framer-motion';
import { MessageSquare, X, Send, ChevronUp, User, LogIn, Lock, XCircle, FileText, Phone, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-1.5 bg-primary origin-left z-[100]"
      style={{ scaleX }}
    />
  );
}

export function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) {
      setTimeout(() => setIsVisible(true), 2000);
    }
  }, []);

  const accept = () => {
    localStorage.setItem('cookie-consent', 'true');
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-card text-card-foreground border border-border/50 shadow-2xl p-6 rounded-2xl z-50 flex flex-col gap-4"
        >
          <div className="flex items-start justify-between">
            <AnimatedHeading as="h3" className="font-serif text-lg font-semibold">Cookie Preferences</AnimatedHeading>
            <button onClick={() => setIsVisible(false)} className="text-muted-foreground hover:text-foreground">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            We use cookies to enhance your browsing experience and analyze our traffic. By clicking "Accept", you consent to our use of cookies.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setIsVisible(false)} className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-full transition-colors">
              Decline
            </button>
            <button onClick={accept} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-full shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors">
              Accept All
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FloatingButtons() {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'bot', text: string}[]>([
    { role: 'bot', text: 'Hello! Welcome to New World Emerald. How can I help you today?' }
  ]);
  const [messageInput, setMessageInput] = useState('');

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const sendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    
    setChatMessages(prev => [...prev, { role: 'user', text: messageInput }]);
    setMessageInput('');
    
    // Simulate bot response
    setTimeout(() => {
      setChatMessages(prev => [...prev, { 
        role: 'bot', 
        text: 'Thank you for your message. An admissions representative will be in touch shortly. For immediate assistance, please call our hotline.' 
      }]);
    }, 1000);
  };

  return (
    <>
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
        <AnimatePresence>
          {showBackToTop && (
            <motion.button
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              onClick={scrollToTop}
              className="w-12 h-12 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center shadow-lg hover:bg-secondary/90 transition-colors"
            >
              <ChevronUp size={24} />
            </motion.button>
          )}
        </AnimatePresence>

        <button 
          onClick={() => setIsChatOpen(true)}
          className="w-14 h-14 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-xl shadow-primary/30 hover:scale-110 transition-transform"
        >
          <MessageSquare size={26} />
        </button>
      </div>

      <AnimatePresence>
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 right-6 w-[350px] bg-card border border-border shadow-2xl rounded-2xl overflow-hidden z-50 flex flex-col"
            style={{ maxHeight: 'calc(100vh - 120px)' }}
          >
            <div className="bg-primary text-primary-foreground p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center overflow-hidden">
                  <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="w-full h-full object-contain p-0.5" />
                </div>
                <div>
                  <AnimatedHeading as="h4" className="font-semibold text-sm">Admissions Assistant</AnimatedHeading>
                  <p className="text-xs text-primary-foreground/80">Typically replies instantly</p>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-primary-foreground/80 hover:text-white">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto min-h-[300px] flex flex-col gap-3 bg-muted/30">
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn(
                  "max-w-[80%] rounded-2xl p-3 text-sm",
                  msg.role === 'bot' 
                    ? "bg-secondary/10 text-foreground self-start rounded-tl-sm" 
                    : "bg-primary text-primary-foreground self-end rounded-tr-sm"
                )}>
                  {msg.text}
                </div>
              ))}
            </div>

            <form onSubmit={sendChatMessage} className="p-3 bg-card border-t border-border flex items-center gap-2">
              <input
                type="text"
                value={messageInput}
                onChange={e => setMessageInput(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 bg-muted rounded-full px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              />
              <button 
                type="submit" 
                disabled={!messageInput.trim()}
                className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center disabled:opacity-50 transition-opacity"
              >
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function PortalsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'student' | 'parent' | 'teacher'>('student');

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-card border border-border shadow-2xl rounded-3xl overflow-hidden"
          >
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground z-10 transition-colors"
            >
              <XCircle size={24} />
            </button>

            <div className="p-8 pb-6 bg-secondary/5 text-center">
              <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="w-14 h-14 object-contain mx-auto mb-4" />
              <AnimatedHeading as="h2" className="font-serif text-2xl font-bold text-foreground">Sign In to Portal</AnimatedHeading>
              <p className="text-sm text-muted-foreground mt-2">Access your personalized dashboard</p>
            </div>

            <div className="p-8 pt-6">
              <div className="flex p-1 bg-muted rounded-xl mb-6">
                {(['student', 'parent', 'teacher'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-all",
                      activeTab === tab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <form className="space-y-4" onSubmit={e => e.preventDefault()}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">ID Number / Email</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input 
                      type="text" 
                      className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder={`Enter your ${activeTab} ID`}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-foreground">Password</label>
                    <a href="#" className="text-xs text-primary hover:underline">Forgot?</a>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input 
                      type="password" 
                      className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
                <button className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2 mt-6">
                  <LogIn size={18} />
                  Sign In
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      className="fixed inset-0 z-[999] bg-background flex flex-col items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="relative"
      >
        <div className="w-24 h-24 border-4 border-muted rounded-full"></div>
        <motion.div 
          className="absolute inset-0 border-4 border-primary rounded-full border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="w-12 h-12 object-contain" />
        </div>
      </motion.div>
      <motion.h2 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-6 font-serif text-xl font-medium tracking-widest text-foreground uppercase"
      >
        New World Emerald
      </motion.h2>
    </motion.div>
  );
}
