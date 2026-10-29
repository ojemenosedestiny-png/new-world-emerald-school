import { lazy, useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { useAuth } from "@clerk/react";
import Home from "@/pages/Home";
import { RouteBoundary } from "@/components/RouteBoundary";

// Keep these imports at route boundaries, not in a shared barrel or layout:
// the public homepage must not download the office and commerce tools.
const SchoolSignIn = lazy(() =>
  import("@/pages/SchoolSignIn").then((module) => ({ default: module.SchoolSignIn })),
);
const Account = lazy(() => import("@/pages/Account"));
const SchoolCommerce = lazy(() => import("@/pages/SchoolCommerce"));
const Admin = lazy(() => import("@/pages/Admin"));
const Portal = lazy(() => import("@/pages/Portal"));
const PortalExam = lazy(() => import("@/pages/PortalExam"));
const PortalManage = lazy(() => import("@/pages/PortalManage"));
const Director = lazy(() => import("@/pages/Director"));
const ActivateAccount = lazy(() => import("@/pages/ActivateAccount"));
const NotFound = lazy(() => import("@/pages/not-found"));

/** The teacher link: signed-in staff go to their workspace; everyone else to staff sign-in, where a new email continues into creating the account. */
function TeacherLink() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/portal/manage" replace />;
  const email = new URLSearchParams(window.location.search).get("email") ?? "";
  const keep = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "&email=" + encodeURIComponent(email) : "";
  return <Redirect to={"/sign-in?returnTo=portal" + keep} replace />;
}

export function AppRoutes() {
  const [location] = useLocation();
  // A new page starts at the top, unless the link points to a section (#admissions).
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [location]);

  return (
    <RouteBoundary key={location}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sign-in/*?">{() => <SchoolSignIn />}</Route>
        <Route path="/sign-up/*?">{() => <SchoolSignIn signup />}</Route>
        <Route path="/account" component={Account} />
        <Route path="/commerce" component={SchoolCommerce} />
        <Route path="/admin" component={Admin} />
        <Route path="/portal" component={Portal} />
        <Route path="/portal/exam/:id" component={PortalExam} />
        <Route path="/portal/manage" component={PortalManage} />
        {/* The short link teachers are given: staff sign-in, then their own classes. */}
        <Route path="/director" component={Director} />
        <Route path="/teacher" component={TeacherLink} />
        <Route path="/portal/activate" component={ActivateAccount} />
        <Route component={NotFound} />
      </Switch>
    </RouteBoundary>
  );
}
