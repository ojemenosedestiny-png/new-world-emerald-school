import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProductPhotoUpload } from "../src/components/ProductPhotoUpload";

vi.mock("@workspace/api-client-react", () => ({
  useRequestUploadUrl: () => ({ mutateAsync: vi.fn() }),
  customFetch: vi.fn(),
}));

afterEach(cleanup);

const previousPhoto = "/api/storage/objects/uploads/previous.jpg";
const completePhoto = "/api/storage/objects/uploads/new-photo.jpg";

function Editor({ initialValue = previousPhoto, disabled = false }) {
  const [value, setValue] = useState(initialValue);
  return <ProductPhotoUpload productKey="fixture" value={value} onChange={setValue}
    disabled={disabled} onUploadingChange={() => {}} />;
}

describe("product photo link entry", () => {
  it("does not assign image request sources for any typed prefix; blur applies the complete link", () => {
    // jsdom does not fetch images. Observe the browser's request trigger (src
    // assignments) directly, including transient assignments between renders.
    const sources: string[] = [];
    const original = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (name, value) {
      if (this.tagName === "IMG" && name === "src") sources.push(value);
      original.call(this, name, value);
    });
    render(<Editor />);
    sources.length = 0;
    const input = screen.getByTestId("input-product-image-url");
    for (let length = 1; length <= completePhoto.length; length++) {
      fireEvent.change(input, { target: { value: completePhoto.slice(0, length) } });
      expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(previousPhoto);
    }
    expect(sources).toEqual([]);
    fireEvent.blur(input);
    expect(sources).toEqual([completePhoto]);
    expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(completePhoto);
    expect(screen.getByRole("status").textContent).toContain("Save the product");
  });

  it("does not create a preview while entering a new product's link", () => {
    render(<Editor initialValue="" />);
    const input = screen.getByTestId("input-product-image-url");
    fireEvent.change(input, { target: { value: "/api/storage/objects/up" } });
    expect(screen.queryByTestId("img-product-photo-preview")).toBeNull();
    fireEvent.change(input, { target: { value: completePhoto } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(completePhoto);
  });

  it.each(["https://", "not a URL", "javascript:alert(1)", "data:image/png;base64,AA"])(
    "keeps the previous photo when applying invalid text: %s", (text) => {
      render(<Editor />);
      const input = screen.getByTestId("input-product-image-url");
      fireEvent.change(input, { target: { value: text } });
      fireEvent.blur(input);
      expect(screen.getByRole("alert").textContent).toContain("has not changed");
      expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(previousPhoto);
    },
  );

  it.each([
    "https://images.example/photo?signature=abc&size=large",
    "http://images.example/photo",
    "/school/api/storage/objects/uploads/photo",
    "//images.example/photo",
  ])("previews legitimate applied links unchanged: %s", (url) => {
    render(<Editor />);
    const input = screen.getByTestId("input-product-image-url");
    fireEvent.change(input, { target: { value: ` ${url} ` } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(url);
    expect((input as HTMLInputElement).value).toBe(url);
  });

  it("allows an empty applied link to clear the photo", () => {
    render(<Editor />);
    const input = screen.getByTestId("input-product-image-url");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(previousPhoto);
    fireEvent.blur(input);
    expect(screen.queryByTestId("img-product-photo-preview")).toBeNull();
  });

  it("synchronizes drafts after external photo changes and switching products", () => {
    const onChange = vi.fn();
    const props = { productKey: "one", value: previousPhoto, onChange, onUploadingChange: vi.fn() };
    const { rerender } = render(<ProductPhotoUpload {...props} />);
    const input = screen.getByTestId("input-product-image-url") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "unfinished" } });
    rerender(<ProductPhotoUpload {...props} value={completePhoto} />);
    expect(input.value).toBe(completePhoto);
    fireEvent.change(input, { target: { value: "another draft" } });
    rerender(<ProductPhotoUpload {...props} productKey="two" value={completePhoto} />);
    expect(input.value).toBe(completePhoto);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not apply a pending draft when the editor is locked", () => {
    const onChange = vi.fn();
    const props = { productKey: "one", value: previousPhoto, onChange, onUploadingChange: vi.fn() };
    const { rerender } = render(<ProductPhotoUpload {...props} />);
    const input = screen.getByTestId("input-product-image-url");
    fireEvent.change(input, { target: { value: completePhoto } });
    rerender(<ProductPhotoUpload {...props} disabled />);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("img-product-photo-preview").getAttribute("src")).toBe(previousPhoto);
  });
});
