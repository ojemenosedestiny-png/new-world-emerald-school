import { useEffect } from "react";

/**
 * Sets the tab title of a public page. The server already sends the right title on the first load;
 * this keeps it right when someone moves between pages inside the app (for example from the portal back home).
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
