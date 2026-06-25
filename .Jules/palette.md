## 2023-11-20 - Adding semantic aria-labels to icon-only buttons
**Learning:** Icon-only buttons with pure `title` tooltips don't guarantee full accessibility. Screen readers and users navigating with keyboards rely on proper `aria-label`s, especially when unpronounceable characters like `☰` or `⮜` are used for icons.
**Action:** Always ensure that icon-only interactive elements contain an `aria-label` attribute describing the functionality of the button.
