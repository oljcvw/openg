---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Open Grind"
  text: "Unofficial Grindr client"
  tagline: Cross-platform, free, libre, ad-free, tracker-free, privacy-centered and community-driven
  actions:
    - theme: brand
      text: Read the user guide
      link: /guides/
    - theme: alt
      text: Developer guide
      link: /development/

features:
  - title: Unlocked grid
    details: Browse, search, filter, change location, and tune grid density
  - title: Location spoofing
    details: Native geolocation change with OpenStreetMap and location search built-in
  - title: Zero ads
    details: No ads, first party, third party or self-promotion, no obstructive pop-ups
  - title: Shared Tauri client
    details: One Svelte interface and Rust core, with native integrations selected per platform
  - title: Privacy by default
    details: No analytics, zero trackers, no data is collected by Open Grind developers
  - title: Security as foundation
    details: Human code review, audit, supply chain security, end-to-end testing
---

<img src="/app-screenshots-1x6.avif" class="hero-screenshots-1x6" alt="Open Grind grid, profile, and messaging screens">
<img src="/app-screenshots-3x2.avif" class="hero-screenshots-3x2" alt="Open Grind grid, profile, and messaging screens">
<img src="/app-screenshots-2x3.avif" class="hero-screenshots-2x3" alt="Open Grind grid, profile, and messaging screens">

<hr />

Android has an established reproducible release pipeline. iOS and iPadOS have
project-owned native implementation, build, test, signing, and
TestFlight-preparation paths, but no signed distribution or device acceptance is
claimed without candidate-specific evidence. Desktop targets remain shared
source/development tracks. See [Platform support](/guides/platform-support).
