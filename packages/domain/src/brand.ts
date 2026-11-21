/**
 * Branding lives in one place so the name, tagline, colours and credits can be changed later.
 * The Rust side reads the same values from apps/desktop/src-tauri/tauri.conf.json (productName).
 */
export const BRAND = {
  name: "DeskWell",
  tagline: "Your Personal Desk Wellness Assistant",
  version: "0.1.0",
  accent: "#6d5dfc",
  author: "Md Ashik Ali",
  authorLinkedIn: "https://www.linkedin.com/in/mdashikali/",
  repository: "https://github.com/tlakib/deskwell",
  license: "MIT",
  disclaimer:
    "DeskWell is a general wellness and habit-support tool. It does not diagnose, treat or prevent any medical condition. Personalise the reminders to your needs and follow professional advice where relevant.",
} as const;
