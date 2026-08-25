---
name: char-creator/player-init
description:
  zh: 开局引导你填写主角信息，并把主角加入故事。
  en: Guides you through creating your hero at the start and brings them into the story.
---

# Deterministic player-creation form

This runtime does not call an LLM. `handler.js` projects the character
attribute schema produced by `world-init/schema-gen` directly into a form, so a
transient provider failure cannot block session setup:

1. The first setup execution returns the `char-creation` form with
   `preGameDone: false`.
2. After submission, `guard.js` deterministically writes the player character
   on the next execution and returns `preGameDone: true`.
3. If a player already exists, the guard skips the handler and refreshes the
   character-panel mirror.

The form always requires a character name and selects at most three editable
attributes in `bio → abilities → social → equipment → stats` order. Numeric
`stats` use schema defaults and do not appear in the form.
