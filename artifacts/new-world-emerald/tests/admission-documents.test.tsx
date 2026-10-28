import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AdmissionsFAQ } from "../src/components/AdmissionsNews";

const api = vi.hoisted(() => ({ create: vi.fn(async () => ({})) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useCreateAdmissionApplication: () => ({ mutateAsync: api.create, isPending: false }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("the apply form lists every document and medical result, sends what is ready, and says what is still needed", async () => {
  render(<AdmissionsFAQ />);
  fireEvent.click(screen.getByText(/Apply Online Now/));
  const docs = screen.getByTestId("fieldset-documents");
  for (const t of ["Medical report", "Birth certificate", "Transfer document", "Statement of results", "Two passport photographs", "Blood group", "Genotype", "Hepatitis B test", "HIV test", "Asthma status"]) {
    expect(docs.textContent).toContain(t);
  }
  expect(docs.textContent).toContain("You do not upload anything here");
  expect(screen.getByTestId("text-medical-privacy").textContent).toContain("sealed envelope");
  expect(screen.getByTestId("text-documents-ready").textContent).toBe("0 of 10 ready");

  fireEvent.click(within(screen.getByTestId("document-birth")).getByRole("checkbox"));
  fireEvent.click(within(screen.getByTestId("document-passport")).getByRole("checkbox"));
  fireEvent.click(within(screen.getByTestId("document-genotype")).getByRole("checkbox"));
  expect(screen.getByTestId("text-documents-ready").textContent).toBe("3 of 10 ready");

  const [first, last] = document.querySelectorAll<HTMLInputElement>('form input[type="text"]');
  fireEvent.change(first, { target: { value: "Ada" } });
  fireEvent.change(last, { target: { value: "Obi" } });
  fireEvent.change(document.querySelector('form input[type="email"]')!, { target: { value: "parent@example.test" } });
  fireEvent.change(document.querySelector('form input[type="tel"]')!, { target: { value: "+2348000000000" } });
  fireEvent.submit(document.querySelector("form")!);

  await vi.waitFor(() => expect(api.create).toHaveBeenCalled());
  expect((api.create.mock.calls[0] as unknown as [{ data: { documentsReady: string[] } }])[0].data.documentsReady).toEqual(["birth", "passport", "genotype"]);
  const missing = await screen.findByTestId("text-documents-missing");
  expect(missing.textContent).toContain("Transfer document");
  expect(missing.textContent).toContain("HIV test");
  expect(missing.textContent).not.toContain("Birth certificate");
});

it("the homepage no longer has a separate requirements section", async () => {
  const home = await import("../src/pages/Home");
  expect(String(home.default)).not.toContain("AdmissionRequirements");
});
