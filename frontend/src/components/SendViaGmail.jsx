/**
 * "Send via Gmail" — the default way a draft leaves.
 *
 * Opens the user's own Gmail in a new tab with the message composed, and then
 * asks them to say so: the compose window is a page we open but cannot see, so
 * whether it was sent is the user's word, booked with "Mark as sent". Until
 * then the draft stays in the queue — closing the tab unsent loses nothing.
 *
 * Gmail's compose link carries text only, so any attachment the draft would
 * have gone out with is named here for the user to add by hand.
 */
import { useState } from "react";

import { gmailComposeUrl } from "../lib/gmail";

export default function SendViaGmail({ to, subject, body, attachments, busy, onMarkSent }) {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <a
        className={`btn-primary ${busy ? "pointer-events-none opacity-40" : ""}`}
        href={gmailComposeUrl({ to, subject, body })}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={busy || undefined}
        onClick={() => setOpened(true)}
      >
        Send via Gmail
      </a>
      <button
        className={opened ? "btn-primary" : "btn-ghost"}
        onClick={onMarkSent}
        disabled={busy}
      >
        Mark as sent
      </button>
      {(opened || attachments?.length > 0) && (
        <p className="basis-full text-[11px] leading-relaxed text-white/45">
          {attachments?.length > 0 &&
            `Attach ${attachments.join(", ")} in Gmail — the compose link can't carry files. `}
          {opened && "Sent it? Mark it as sent so it's tracked and follow-ups are scheduled."}
        </p>
      )}
    </>
  );
}
