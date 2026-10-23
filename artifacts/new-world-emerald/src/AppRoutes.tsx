import { lazy } from "react";
import { Route, Switch, useLocation } from "wouter";
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
const NotFound = lazy(() => import("@/pages/not-found"));

export function AppRoutes() {
  const [location] = useLocation();

  return (
    <RouteBoundary key={location}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sign-in/*?">{() => <SchoolSignIn />}</Route>
        <Route path="/sign-up/*?">{() => <SchoolSignIn signup />}</Route>
        <Route path="/account" component={Account} />
        <Route path="/commerce" component={SchoolCommerce} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </RouteBoundary>
  );
}
