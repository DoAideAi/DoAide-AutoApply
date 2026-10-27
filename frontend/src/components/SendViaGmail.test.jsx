import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SendViaGmail from "./SendViaGmail";

function renderButton(props = {}) {
  const onMarkSent = vi.fn();
  render(
    <SendViaGmail
      to="talent@acme.com"
      subject="Backend role"
      body="Hello"
      onMarkSent={onMarkSent}
      {...props}
    />,
  );
  return onMarkSent;
}

describe("SendViaGmail", () => {
  it("opens a pre-filled Gmail compose window in a new tab", () => {
    renderButton();
    const link = screen.getByRole("link", { name: "Send via Gmail" });
    expect(link).toHaveAttribute(
      "href",
      "https://mail.google.com/mail/?view=cm&to=talent%40acme.com&su=Backend%20role&body=Hello",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("asks to be marked sent once Gmail was opened", async () => {
    const user = userEvent.setup();
    const onMarkSent = renderButton();
    const link = screen.getByRole("link", { name: "Send via Gmail" });
    link.addEventListener("click", (e) => e.preventDefault());

    expect(screen.queryByText(/Sent it\?/)).not.toBeInTheDocument();
    await user.click(link);
    expect(screen.getByText(/Sent it\?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toHaveClass("btn-primary");

    await user.click(screen.getByRole("button", { name: "Mark as sent" }));
    expect(onMarkSent).toHaveBeenCalledTimes(1);
  });

  it("names the attachments Gmail's link cannot carry", () => {
    renderButton({ attachments: ["resume.pdf"] });
    expect(screen.getByText(/Attach resume\.pdf in Gmail/)).toBeInTheDocument();
  });

  it("is inert while busy", () => {
    renderButton({ busy: true });
    expect(screen.getByRole("link", { name: "Send via Gmail" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeDisabled();
  });
});
