import { describe, expect, it } from "vitest";

import { gmailComposeUrl } from "./gmail";

describe("gmailComposeUrl", () => {
  it("builds a Gmail compose link", () => {
    expect(gmailComposeUrl({ to: "a@b.com", subject: "Hi", body: "Hello" })).toBe(
      "https://mail.google.com/mail/?view=cm&to=a%40b.com&su=Hi&body=Hello",
    );
  });

  it("percent-encodes every value, keeping spaces and newlines intact", () => {
    const body = "Hi Sam,\n\nR&D + ML — 100% keen? #1\n\nJordan";
    const url = gmailComposeUrl({ to: "sam+jobs@acme.com", subject: "Role: A & B", body });

    expect(url).not.toContain("+");
    expect(url).not.toContain(" ");
    const params = new URL(url).searchParams;
    expect(params.get("to")).toBe("sam+jobs@acme.com");
    expect(params.get("su")).toBe("Role: A & B");
    expect(params.get("body")).toBe(body);
  });

  it("leaves out what it was not given", () => {
    expect(gmailComposeUrl({ to: "a@b.com" })).toBe(
      "https://mail.google.com/mail/?view=cm&to=a%40b.com",
    );
  });
});
