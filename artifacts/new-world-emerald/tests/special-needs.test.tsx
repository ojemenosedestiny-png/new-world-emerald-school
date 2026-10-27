import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SpecialNeeds } from "../src/components/SpecialNeeds";

afterEach(cleanup);

it("explains how the school supports children with special educational needs, with a way to get in touch", () => {
  render(<SpecialNeeds />);
  const section = screen.getByTestId("section-special-needs");
  expect(section.id).toBe("special-needs");
  expect(section.textContent).toContain("Special Educational Needs (SEN)");
  expect(screen.getAllByTestId("card-sen-support").map((c) => c.querySelector("h3")?.textContent)).toEqual([
    "Getting to know your child", "A plan for every child", "Support in the classroom", "Working in partnership",
  ]);
  expect(screen.getByTestId("link-sen-enquiry").getAttribute("href")).toContain("subject=Special%20Educational%20Needs%20enquiry");
  expect(screen.getByTestId("link-sen-phone").getAttribute("href")).toBe("tel:+2348136037074");
});
