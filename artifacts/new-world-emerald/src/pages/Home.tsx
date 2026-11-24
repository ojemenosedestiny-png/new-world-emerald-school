import { MotionConfig } from 'framer-motion';
import { HomepageHeadingAnimations } from '@/components/AnimatedHeading';
import { Navbar, Footer } from '@/components/Layout';
import { Hero, About, WhyChooseUs } from '@/components/HeroAbout';
import { DirectorWelcome } from '@/components/DirectorWelcome';
import { ParentServices } from '@/components/ParentServices';
import { Programs, Facilities } from '@/components/ProgramsFacilities';
import { SpecialNeeds } from '@/components/SpecialNeeds';
import { SchoolLife, Gallery, Testimonials } from '@/components/LifeGallery';
import { NewsEvents, AdmissionsFAQ, FinalCTA } from '@/components/AdmissionsNews';
import { AcademicCalendar } from '@/components/AcademicCalendar';
import { LiveUpdates } from '@/components/LiveUpdates';
import { ScrollProgress, CookieBanner, FloatingButtons } from '@/components/Widgets';
import { isSchoolSectionVisible, useSchoolContentRevision } from '@/lib/siteContent';
import { usePageTitle } from "@/lib/pageTitle";

const schoolSections = [
  { name: "Hero", Component: Hero },
  { name: "DirectorWelcome", Component: DirectorWelcome },
  { name: "About", Component: About },
  { name: "WhyChooseUs", Component: WhyChooseUs },
  { name: "Programs", Component: Programs },
  { name: "SpecialNeeds", Component: SpecialNeeds },
  { name: "Facilities", Component: Facilities },
  { name: "SchoolLife", Component: SchoolLife },
  { name: "Gallery", Component: Gallery },
  { name: "Testimonials", Component: Testimonials },
  { name: "NewsEvents", Component: NewsEvents },
  { name: "LiveUpdates", Component: LiveUpdates },
  { name: "AcademicCalendar", Component: AcademicCalendar },
  { name: "AdmissionsFAQ", Component: AdmissionsFAQ },
  { name: "ParentServices", Component: ParentServices },
  { name: "FinalCTA", Component: FinalCTA },
];

export default function Home() {
  usePageTitle("New World Emerald Private School | Kubwa, Abuja");
  useSchoolContentRevision();

  return (
    <MotionConfig reducedMotion="user">
      <ScrollProgress />

      <HomepageHeadingAnimations>
      <div>
          <Navbar />
        
        <main>
          {schoolSections.map(({ name, Component }) => isSchoolSectionVisible(name) ? <Component key={name} /> : null)}
        </main>

        <Footer />
        <FloatingButtons />
        <CookieBanner />
      </div>
      </HomepageHeadingAnimations>
    </MotionConfig>
  );
}
