---
name: char-creator/player-init
description:
  zh: 开局引导你填写主角信息，并把主角加入故事。
  en: Guides you through creating your hero at the start and brings them into the story.
---

# Deterministic player-creation form

This runtime does not call an LLM. `handler.js` owns the complete deterministic
flow, so a transient provider failure cannot block session setup:

1. The first setup execution projects the character attribute schema from
   `world-init/schema-gen` into the `char-creation` form and returns
   `preGameDone: false`.
2. After submission, the next execution reads `player_inputs`, atomically
   writes the player and character-panel mirror, and returns
   `preGameDone: true` without generating another form.
3. If a player already exists, the handler completes setup and refreshes the
   character-panel mirror.

The form always requires a character name and selects at most three editable
attributes in `bio → abilities → social → equipment → stats` order. Numeric
`stats` use schema defaults and do not appear in the form.
