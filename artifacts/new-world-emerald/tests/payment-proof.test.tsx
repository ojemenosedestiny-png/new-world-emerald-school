import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AttachProofForm, BankAccountsPanel } from "../src/components/PaymentProof";

const api = vi.hoisted(() => ({ upload: vi.fn(), attach: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  uploadPaymentProof: api.upload,
  attachPaymentProof: api.attach,
}));
afterEach(cleanup);

it("shows each bank account with a copy button", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<BankAccountsPanel accounts={[{ label: "School fees", bankName: "First Bank", accountName: "New World Emerald Private School", accountNumber: "0123456789" }]} />);
  expect(screen.getByTestId("card-bank-0123456789").textContent).toContain("First Bank");
  fireEvent.click(screen.getByRole("button", { name: "Copy account number 0123456789" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("0123456789"));
  expect(await screen.findByText("Copied")).toBeTruthy();
});

it("hides the panel when the office has not added an account", () => {
  const { container } = render(<BankAccountsPanel accounts={[]} />);
  expect(container.textContent).toBe("");
});

it("adds a screenshot to an existing order", async () => {
  api.upload.mockResolvedValue({ proofId: "proof-1" });
  api.attach.mockResolvedValue({ message: "Screenshot added. The School Office will confirm your payment." });
  render(<AttachProofForm />);
  fireEvent.click(screen.getByTestId("button-open-attach-proof"));
  fireEvent.click(screen.getByTestId("button-attach-proof"));
  expect(screen.getByTestId("text-attach-result").textContent).toContain("Enter your reference");
  fireEvent.change(screen.getByTestId("input-attach-reference"), { target: { value: " NWE-ORD-ABC " } });
  fireEvent.change(screen.getByTestId("input-attach-email"), { target: { value: "parent@example.test" } });
  fireEvent.change(screen.getByTestId("input-attach-proof"), { target: { files: [new File([new Uint8Array(20)], "transfer.png", { type: "image/png" })] } });
  fireEvent.click(screen.getByTestId("button-attach-proof"));
  await waitFor(() => expect(api.attach).toHaveBeenCalledWith({ reference: "NWE-ORD-ABC", email: "parent@example.test", proofId: "proof-1" }));
  expect((await screen.findByTestId("text-attach-result")).textContent).toContain("Screenshot added");
});
