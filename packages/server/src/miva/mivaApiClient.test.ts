import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signRequestBody } from "./mivaApiClient";

describe("signRequestBody", () => {
  it("matches HMAC-SHA256 over the raw body using the base64-decoded signing key, per docs.miva.com", () => {
    const signingKey = Buffer.from("test-signing-key-material").toString("base64");
    const rawBody = JSON.stringify({ Store_Code: "TEST", Function: "ProductList_Load_Query" });

    const expected = createHmac("sha256", Buffer.from(signingKey, "base64")).update(rawBody, "utf8").digest("base64");

    expect(signRequestBody(rawBody, signingKey)).toBe(expected);
  });

  it("produces a different signature when the body changes (detects tampering)", () => {
    const signingKey = Buffer.from("another-key").toString("base64");
    const sigA = signRequestBody(JSON.stringify({ a: 1 }), signingKey);
    const sigB = signRequestBody(JSON.stringify({ a: 2 }), signingKey);
    expect(sigA).not.toBe(sigB);
  });
});
