import { MotionConfig } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { getListClassFeeSchedulesQueryKey, getListStoreProductsQueryKey } from '@workspace/api-client-react';
import { HomepageHeadingAnimations } from '@/components/AnimatedHeading';
import { Navbar, Footer } from '@/components/Layout';
import { Hero, About, WhyChooseUs } from '@/components/HeroAbout';
import { DirectorWelcome } from '@/components/DirectorWelcome';
import { ParentServices } from '@/components/ParentServices';
import { FifthAnniversary } from '@/components/FifthAnniversary';
import { Programs, Facilities } from '@/components/ProgramsFacilities';
import { SchoolLife, Gallery, Testimonials } from '@/components/LifeGallery';
import { NewsEvents, AdmissionsFAQ, FinalCTA } from '@/components/AdmissionsNews';
import { AcademicCalendar } from '@/components/AcademicCalendar';
import { LiveUpdates } from '@/components/LiveUpdates';
import { ScrollProgress, CookieBanner, FloatingButtons } from '@/components/Widgets';
import { isSchoolSectionVisible, useSchoolContentRevision } from '@/lib/siteContent';

const schoolSections = [
  { name: "Hero", Component: Hero },
  { name: "ParentServices", Component: ParentServices },
  { name: "FifthAnniversary", Component: FifthAnniversary },
  { name: "DirectorWelcome", Component: DirectorWelcome },
  { name: "About", Component: About },
  { name: "WhyChooseUs", Component: WhyChooseUs },
  { name: "Programs", Component: Programs },
  { name: "Facilities", Component: Facilities },
  { name: "SchoolLife", Component: SchoolLife },
  { name: "Gallery", Component: Gallery },
  { name: "Testimonials", Component: Testimonials },
  { name: "NewsEvents", Component: NewsEvents },
  { name: "LiveUpdates", Component: LiveUpdates },
  { name: "AcademicCalendar", Component: AcademicCalendar },
  { name: "AdmissionsFAQ", Component: AdmissionsFAQ },
  { name: "FinalCTA", Component: FinalCTA },
];

export default function Home() {
  useSchoolContentRevision();
  const queryClient = useQueryClient();
  const productsFetching = useIsFetching({ queryKey: getListStoreProductsQueryKey() });
  const feesFetching = useIsFetching({ queryKey: getListClassFeeSchedulesQueryKey() });
  const positionedAnniversary = useRef(false);

  useEffect(() => {
    // Wait for the panels above the anniversary to settle before positioning
    // a shared link or a link arriving from another page. Never reset a
    // visitor's scroll position on the panels' subsequent polling refreshes.
    if (positionedAnniversary.current || window.location.hash !== '#anniversary') return;
    if (queryClient.isFetching({ queryKey: getListStoreProductsQueryKey() }) ||
        queryClient.isFetching({ queryKey: getListClassFeeSchedulesQueryKey() })) return;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById('anniversary');
      if (section) {
        section.scrollIntoView({ block: 'start', behavior: 'instant' });
        positionedAnniversary.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [productsFetching, feesFetching, queryClient]);

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
