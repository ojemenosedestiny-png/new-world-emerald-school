import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from "@/lib/asset";
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'wouter';
import { Menu, X, ChevronDown, MapPin, Phone, Mail, Instagram, Twitter, Facebook, Linkedin, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PortalsModal } from './Widgets';

export function Navbar({ solid = false }: { solid?: boolean }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const hasSolidBackground = isScrolled || solid;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPortalsOpen, setIsPortalsOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'About', href: '#about' },
    { name: 'Academics', href: '#academics' },
    { name: 'School Life', href: '#school-life' },
    { name: 'Calendar', href: '#calendar' },
    { name: 'Admissions', href: '#admissions' },
    { name: 'News', href: '#news' },
    { name: 'Live Updates', href: '#live-updates' },
  ];

  return (
    <>
      {/* Top Bar - Hidden on mobile */}
      <div className="hidden lg:flex bg-secondary text-secondary-foreground text-xs py-2 px-8 justify-between items-center">
        <div className="flex items-center gap-6">
          <a href="tel:+2348136037074" className="flex items-center gap-2 hover:text-primary transition-colors"><Phone size={14} /> +234 813 603 7074</a>
          <a href="mailto:info@newworldemeraldprivateschool.com" className="flex items-center gap-2 hover:text-primary transition-colors"><Mail size={14} /> info@newworldemeraldprivateschool.com</a>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setIsPortalsOpen(true)} className="hover:text-primary transition-colors flex items-center gap-1">
            <UserIcon size={14} /> Portals Login
          </button>
          <a href="#" className="hover:text-primary transition-colors">Prospectus</a>
          <a href="#calendar" className="hover:text-primary transition-colors">Calendar</a>
          <Link href="/commerce?section=fees" className="hover:text-primary transition-colors">Fees &amp; Store</Link>
          <a href={asset("/admin")} className="hover:text-primary transition-colors">Admin Panel</a>
        </div>
      </div>

      <motion.nav
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className={cn(
          "fixed w-full z-50 transition-all duration-300",
          isScrolled ? "top-0 glass-nav py-3" : solid ? "top-0 lg:top-8 glass-nav py-5" : "top-0 lg:top-8 bg-transparent py-5"
        )}
      >
        <div className="container mx-auto px-4 md:px-8 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-3 z-50">
            <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="w-11 h-11 object-contain drop-shadow-lg" />
            <div className={cn("flex flex-col", !hasSolidBackground && "text-white drop-shadow-md")}>
              <span className={cn("font-serif font-bold text-xl leading-tight", hasSolidBackground ? "text-foreground" : "text-white")}>N.W. Emerald</span>
              <span className={cn("text-[10px] uppercase tracking-widest", hasSolidBackground ? "text-muted-foreground" : "text-white/80")}>Private School</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-8">
            <ul className="flex items-center gap-6">
              {navLinks.map((link) => (
                <li key={link.name}>
                  <a 
                    href={solid ? asset(`/${link.href}`) : link.href}
                    className={cn(
                      "text-sm font-medium hover:text-primary transition-colors relative group",
                      !hasSolidBackground ? "text-white drop-shadow-md" : "text-foreground"
                    )}
                  >
                    {link.name}
                    <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-primary transition-all group-hover:w-full"></span>
                  </a>
                </li>
              ))}
            </ul>
            <a 
              href="#admissions" 
              className={cn(
                "px-6 py-2.5 rounded-full font-semibold text-sm transition-all shadow-lg hover:-translate-y-0.5",
                isScrolled 
                  ? "bg-primary text-primary-foreground shadow-primary/20 hover:shadow-primary/40" 
                  : "bg-white text-secondary hover:bg-white/90"
              )}
            >
              Apply Now
            </a>
          </div>

          {/* Mobile Toggle */}
          <button 
            className="lg:hidden z-50 p-2"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? (
              <X size={24} className={hasSolidBackground ? "text-foreground" : "text-white"} />
            ) : (
              <Menu size={24} className={hasSolidBackground ? "text-foreground" : "text-white"} />
            )}
          </button>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: '100vh' }}
              exit={{ opacity: 0, height: 0 }}
              className="absolute top-0 left-0 w-full bg-background pt-24 px-8 pb-8 overflow-y-auto flex flex-col shadow-2xl"
            >
              <ul className="flex flex-col gap-6 text-xl font-serif">
                {navLinks.map((link) => (
                  <motion.li 
                    key={link.name}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                  >
                    <a 
                      href={solid ? asset(`/${link.href}`) : link.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="text-foreground hover:text-primary block"
                    >
                      {link.name}
                    </a>
                  </motion.li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-4">
                <Link
                  href="/commerce?section=fees"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 font-semibold text-primary"
                  data-testid="link-mobile-fees-store"
                >
                  Fees &amp; Store <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <button onClick={() => {setIsPortalsOpen(true); setIsMobileMenuOpen(false);}} className="text-left font-medium flex items-center gap-2 text-muted-foreground">
                  <UserIcon size={18} /> Portals Login
                </button>
                <a href="#admissions" onClick={() => setIsMobileMenuOpen(false)} className="bg-primary text-primary-foreground text-center py-4 rounded-xl font-bold mt-4">
                  Apply Now
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      <PortalsModal isOpen={isPortalsOpen} onClose={() => setIsPortalsOpen(false)} />
    </>
  );
}

export function Footer() {
  return (
    <footer className="bg-secondary text-secondary-foreground pt-20 pb-10 border-t-4 border-primary">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <img src={asset("/logo.jpg")} alt="New World Emerald logo" className="w-11 h-11 object-contain" />
              <div className="flex flex-col">
                <span className="font-serif font-bold text-xl leading-tight">N.W. Emerald</span>
                <span className="text-[10px] uppercase tracking-widest text-secondary-foreground/60">Private School</span>
              </div>
            </div>
            <p className="text-sm text-secondary-foreground/80 leading-relaxed">
              Building future leaders through excellence in education, character development, and global awareness.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all"><Facebook size={18} /></a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all"><Twitter size={18} /></a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all"><Instagram size={18} /></a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all"><Linkedin size={18} /></a>
            </div>
          </div>

          <div>
            <AnimatedHeading as="h3" className="font-serif text-lg font-semibold mb-6">Quick Links</AnimatedHeading>
            <ul className="space-y-3 text-sm text-secondary-foreground/80">
              <li><a href="#about" className="hover:text-primary transition-colors flex items-center gap-2"><ArrowRight size={14} /> About Us</a></li>
              <li><a href="#academics" className="hover:text-primary transition-colors flex items-center gap-2"><ArrowRight size={14} /> Academic Programs</a></li>
              <li><a href="#admissions" className="hover:text-primary transition-colors flex items-center gap-2"><ArrowRight size={14} /> Admissions</a></li>
              <li><a href={asset("/admin")} className="hover:text-primary transition-colors flex items-center gap-2"><ArrowRight size={14} /> Admin Panel</a></li>
              <li><a href="#school-life" className="hover:text-primary transition-colors flex items-center gap-2"><ArrowRight size={14} /> School Life</a></li>
              <li><a href="#" className="hover:text-primary transition-colors flex items-center gap-2"><ArrowRight size={14} /> Career Opportunities</a></li>
            </ul>
          </div>

          <div>
            <AnimatedHeading as="h3" className="font-serif text-lg font-semibold mb-6">Contact Us</AnimatedHeading>
            <ul className="space-y-4 text-sm text-secondary-foreground/80">
              <li className="flex items-start gap-3">
                <MapPin className="text-primary mt-1 shrink-0" size={18} />
                <span>Emerald Building, New World Crescent,<br/>Oyigene Audu Avenue, F01 Kubwa, Abuja</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="text-primary shrink-0" size={18} />
                <a href="tel:+2348136037074" className="hover:text-primary transition-colors">+234 813 603 7074</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="text-primary shrink-0" size={18} />
                <a href="mailto:info@newworldemeraldprivateschool.com" className="hover:text-primary transition-colors break-all">info@newworldemeraldprivateschool.com</a>
              </li>
            </ul>
          </div>

          <div>
            <AnimatedHeading as="h3" className="font-serif text-lg font-semibold mb-6">Newsletter</AnimatedHeading>
            <p className="text-sm text-secondary-foreground/80 mb-4">Subscribe to receive updates, access to exclusive deals, and more.</p>
            <form className="flex flex-col gap-3" onSubmit={e => e.preventDefault()}>
              <input 
                type="email" 
                placeholder="Enter your email address" 
                className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm outline-none focus:border-primary transition-colors"
              />
              <button className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-3 rounded-lg transition-colors shadow-lg shadow-primary/20">
                Subscribe
              </button>
            </form>
          </div>
        </div>

        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-secondary-foreground/60">
          <p>© {new Date().getFullYear()} New World Emerald Private School. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Cookie Policy</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

// Simple internal icon to avoid large imports just for one user icon
function UserIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
