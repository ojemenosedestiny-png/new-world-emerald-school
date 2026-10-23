import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  customFetch,
  getGetLocalAccountQueryKey,
  getGetLocalAccountQueryOptions,
  useGetLocalAccount,
} from "@workspace/api-client-react";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API client public exports", () => {
  it("exposes the account hook and its existing endpoint and query key", () => {
    expect(useGetLocalAccount).toBeTypeOf("function");
    expect(getGetLocalAccountQueryKey()).toEqual(["/api/account"]);
    expect(getGetLocalAccountQueryOptions().queryKey).toEqual(
      getGetLocalAccountQueryKey(),
    );
  });

  it("keeps cookie credentials on account requests without adding a bearer token", async () => {
    const account = { id: "school-account", isAdmin: false };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(account), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const options = getGetLocalAccountQueryOptions();
    if (typeof options.queryFn !== "function") {
      throw new Error("Expected the account query to expose its request function");
    }

    const result = await options.queryFn({
      signal: controller.signal,
      queryKey: options.queryKey,
      client: {} as never,
      meta: undefined,
    });

    expect(result).toEqual(account);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        signal: controller.signal,
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers.has("authorization")).toBe(false);
  });

  it.each([401, 403])("preserves ApiError identity for admin access failures (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Access denied" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ));

    const error = await customFetch("/api/website-admin/access").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error instanceof ApiError && [401, 403].includes(error.status)).toBe(true);
  });
});
