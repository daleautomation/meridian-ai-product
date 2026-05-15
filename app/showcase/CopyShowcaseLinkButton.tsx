"use client";

import { useState } from "react";

export function CopyShowcaseLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const href = new URL(path, window.location.origin).toString();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
      } else {
        fallbackCopy(href);
      }
    } catch {
      fallbackCopy(href);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 4000);
  }

  return (
    <button
      type="button"
      className="showcase-copy-button"
      onClick={copyLink}
      aria-live="polite"
    >
      {copied ? "Copied" : "Copy Link"}
    </button>
  );
}

function fallbackCopy(value: string) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}
