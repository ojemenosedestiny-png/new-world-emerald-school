import { AnimatedHeading } from "@/components/AnimatedHeading";
import { asset } from "@/lib/asset";
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronRight, FileText, Download, CheckCircle2, ArrowRight, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreateAdmissionApplication } from '@workspace/api-client-react';
import { trackEvent } from '@/lib/analytics';

export function NewsEvents() {
  const news = [
    {
      img: asset("/graduation.jpg"),
      date: "Oct 15, 2024",
      title: "Class of 2024 Achieves Record Outstanding Results",
      type: "News"
    },
    {
      img: asset("/science-lab.jpg"),
      date: "Nov 02, 2024",
      title: "Annual Science and Technology Exhibition",
      type: "Event"
    },
    {
      img: asset("/sports.jpg"),
      date: "Nov 18, 2024",
      title: "Inter-House Sports Competition Finals",
      type: "Event"
    }
  ];

  return (
    <section id="news" className="py-24 bg-muted/30">
      <div className="container mx-auto px-4 md:px-8">
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-6">
          <div>
            <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Stay Updated</AnimatedHeading>
            <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground">
              Latest News & Events.
            </AnimatedHeading>
          </div>
          <button className="flex items-center gap-2 font-bold text-primary hover:text-accent transition-colors">
            View Full Calendar <ArrowRight size={20} />
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {news.map((item, i) => (
            <div key={i} className="bg-card rounded-2xl overflow-hidden border border-border shadow-sm hover:shadow-xl transition-all group">
              <div className="relative h-56 overflow-hidden">
                <img src={item.img} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                <div className="absolute top-4 left-4 bg-background px-3 py-1 rounded-full text-xs font-bold text-foreground shadow">
                  {item.type}
                </div>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                  <Calendar size={16} />
                  {item.date}
                </div>
                <AnimatedHeading as="h4" className="font-serif text-xl font-bold text-foreground mb-4 group-hover:text-primary transition-colors line-clamp-2">
                  {item.title}
                </AnimatedHeading>
                <a href="#" className="inline-flex items-center gap-2 text-sm font-bold text-primary group-hover:translate-x-1 transition-transform">
                  Read More <ChevronRight size={16} />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AdmissionsFAQ() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const createApplication = useCreateAdmissionApplication();
  const [isApplicationSubmitted, setIsApplicationSubmitted] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [application, setApplication] = useState({
    studentFirstName: '',
    studentLastName: '',
    grade: 'Creche',
    entryYear: '2025/2026',
    guardianEmail: '',
    guardianPhone: '',
  });

  const updateApplication = (field: keyof typeof application, value: string) => {
    setApplication((current) => ({ ...current, [field]: value }));
  };

  const submitApplication = async (event: React.FormEvent) => {
    event.preventDefault();
    setApplicationError('');
    try {
      await createApplication.mutateAsync({ data: application });
      trackEvent('admission_application_submitted');
      setIsApplicationSubmitted(true);
    } catch {
      setApplicationError('We could not submit your application. Please try again or call the school office.');
    }
  };

  const faqs = [
    { q: "What is the admission process?", a: "The process begins with an online application, followed by an entrance examination and an interview with the student and parents. Successful candidates will receive an offer letter within two weeks." },
    { q: "Do you offer scholarships?", a: "Yes, we offer merit-based scholarships for exceptional students entering Senior Secondary. Financial aid is also available on a limited, case-by-case basis." },
    { q: "What are the school fees?", a: "School fees vary by grade level. Please download our prospectus or contact the admissions office for a detailed breakdown of tuition and other fees." },
    { q: "Is there a boarding facility?", a: "Yes, we offer premium boarding facilities for students from Junior Secondary upwards, providing a structured, safe, and nurturing environment." },
  ];

  return (
    <section id="admissions" className="py-24 bg-background">
      <div className="container mx-auto px-4 md:px-8">
        <div className="grid lg:grid-cols-2 gap-16">
          <div>
            <AnimatedHeading as="h2" className="text-primary font-bold tracking-widest uppercase text-sm mb-3">Join Us</AnimatedHeading>
            <AnimatedHeading as="h3" className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
              Start Your Journey <br/>With Emerald.
            </AnimatedHeading>
            <p className="text-muted-foreground text-lg mb-8">
              We welcome students who are curious, ambitious, and ready to embrace our values. Our admissions team is here to guide you through every step.
            </p>
            
            <div className="space-y-6 mb-10">
              {[
                "Submit Application Form Online",
                "Entrance Examination & Assessment",
                "Parent & Student Interview",
                "Offer & Enrollment"
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    {i + 1}
                  </div>
                  <span className="font-medium text-foreground">{step}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={() => {
                  trackEvent('admission_form_opened');
                  setIsApplyModalOpen(true);
                }}
                className="px-8 py-4 bg-primary text-primary-foreground rounded-full font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
              >
                <FileText size={20} /> Apply Online Now
              </button>
              <button className="px-8 py-4 bg-muted text-foreground rounded-full font-bold hover:bg-muted/80 transition-all flex items-center justify-center gap-2">
                <Download size={20} /> Download Prospectus
              </button>
            </div>
          </div>

          <div>
            <div className="bg-card border border-border rounded-3xl p-8 shadow-sm">
              <AnimatedHeading as="h4" className="font-serif text-2xl font-bold mb-6">Frequently Asked Questions</AnimatedHeading>
              <div className="space-y-4">
                {faqs.map((faq, i) => (
                  <div key={i} className="border border-border rounded-xl overflow-hidden">
                    <button 
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}
                      className="w-full px-6 py-4 flex justify-between items-center bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                    >
                      <span className="font-semibold text-foreground">{faq.q}</span>
                      <ChevronDown className={cn("text-muted-foreground transition-transform", openFaq === i && "rotate-180")} size={20} />
                    </button>
                    <AnimatePresence>
                      {openFaq === i && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-6 bg-card text-muted-foreground text-sm leading-relaxed border-t border-border">
                            {faq.a}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Apply Modal */}
      <AnimatePresence>
        {isApplyModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsApplyModalOpen(false)}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-card border border-border shadow-2xl rounded-3xl overflow-hidden my-8"
            >
              <div className="bg-primary p-6 flex justify-between items-center text-primary-foreground">
                <AnimatedHeading as="h3" className="font-serif text-2xl font-bold">Online Application Form</AnimatedHeading>
                <button onClick={() => setIsApplyModalOpen(false)} className="hover:text-white/80">
                  <X size={24} />
                </button>
              </div>
              
              <div className="p-8">
                {isApplicationSubmitted ? (
                  <div className="py-8 text-center">
                    <CheckCircle2 className="mx-auto mb-5 text-primary" size={48} />
                    <AnimatedHeading as="h4" className="font-serif text-3xl font-bold text-foreground">Application received</AnimatedHeading>
                    <p className="mx-auto mt-4 max-w-md leading-relaxed text-muted-foreground">
                      Thank you for applying to New World Emerald. Our admissions team will contact you shortly with the next steps.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsApplicationSubmitted(false);
                        setApplication({
                          studentFirstName: '',
                          studentLastName: '',
                          grade: 'Creche',
                          entryYear: '2025/2026',
                          guardianEmail: '',
                          guardianPhone: '',
                        });
                        setIsApplyModalOpen(false);
                      }}
                      className="mt-8 rounded-xl bg-primary px-6 py-3 font-bold text-primary-foreground"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                <form className="space-y-6" onSubmit={submitApplication}>
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Student's First Name</label>
                      <input required type="text" value={application.studentFirstName} onChange={(e) => updateApplication('studentFirstName', e.target.value)} className="w-full p-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Student's Last Name</label>
                      <input required type="text" value={application.studentLastName} onChange={(e) => updateApplication('studentLastName', e.target.value)} className="w-full p-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50" />
                    </div>
                  </div>
                  
                  <div className="grid sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Grade Applying For</label>
                      <select value={application.grade} onChange={(e) => updateApplication('grade', e.target.value)} className="w-full p-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50">
                        <option>Creche</option>
                        <option>Nursery</option>
                        <option>Primary (Year 1-6)</option>
                        <option>Junior Secondary (Year 7-9)</option>
                        <option>Senior Secondary (Year 10-12)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Proposed Entry Year</label>
                      <select value={application.entryYear} onChange={(e) => updateApplication('entryYear', e.target.value)} className="w-full p-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50">
                        <option>2025/2026</option>
                        <option>2026/2027</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Parent/Guardian Email</label>
                    <input required type="email" value={application.guardianEmail} onChange={(e) => updateApplication('guardianEmail', e.target.value)} className="w-full p-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Parent/Guardian Phone</label>
                    <input required type="tel" value={application.guardianPhone} onChange={(e) => updateApplication('guardianPhone', e.target.value)} placeholder="+234..." className="w-full p-3 bg-background border border-border rounded-xl outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>

                  <div className="bg-muted p-4 rounded-xl flex items-start gap-3">
                    <CheckCircle2 className="text-primary shrink-0 mt-0.5" />
                    <p className="text-sm text-muted-foreground">
                      This is a preliminary application. Upon submission, an admissions representative will contact you with details on the assessment fee and examination dates.
                    </p>
                  </div>

                  {applicationError && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{applicationError}</p>}

                  <div className="flex justify-end gap-4 pt-4 border-t border-border">
                    <button type="button" onClick={() => setIsApplyModalOpen(false)} className="px-6 py-3 rounded-xl font-medium hover:bg-muted">
                      Cancel
                    </button>
                    <button type="submit" disabled={createApplication.isPending} className="px-6 py-3 bg-primary text-primary-foreground rounded-xl font-bold shadow-lg shadow-primary/20 disabled:opacity-60">
                      {createApplication.isPending ? 'Submitting…' : 'Submit Application'}
                    </button>
                  </div>
                </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-primary z-0"></div>
      {/* Decorative patterns */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3"></div>
      
      <div className="container relative z-10 mx-auto px-4 text-center">
        <AnimatedHeading as="h2" className="text-4xl md:text-6xl font-serif font-bold text-primary-foreground mb-6 max-w-4xl mx-auto leading-tight">
          Give Your Child the Best <br className="hidden md:block" /> Foundation for Life.
        </AnimatedHeading>
        <p className="text-xl text-primary-foreground/80 mb-12 max-w-2xl mx-auto">
          Enrollments are now open for the upcoming academic year. Join a community committed to nurturing brilliance.
        </p>
        
        <div className="flex flex-col sm:flex-row justify-center gap-4">
          <a href="#admissions" className="px-10 py-5 bg-accent text-accent-foreground rounded-full font-bold text-lg hover:bg-accent/90 transition-all shadow-xl shadow-accent/20 transform hover:-translate-y-1">
            Apply Today
          </a>
          <a href="mailto:info@newworldemeraldprivateschool.com?subject=Admissions%20Enquiry" className="px-10 py-5 bg-transparent border-2 border-primary-foreground/30 text-primary-foreground rounded-full font-bold text-lg hover:bg-white/10 transition-all backdrop-blur-sm">
            Contact Admissions
          </a>
        </div>
      </div>
    </section>
  );
}
