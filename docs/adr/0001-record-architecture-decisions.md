# 0001. Record architecture decisions

## Status

Accepted

## Context

animeshkundu/media-tools needs durable decision records so future contributors can understand why architectural and process choices were made instead of rediscovering them from code or chat history.

## Decision

Record significant architecture and long-lived process decisions as ADRs under `docs/adr/` or the repository's established ADR directory. Use the Nygard-style template at `docs/adr/0000-template.md` when creating new records.

## Consequences

### Positive

- Decisions become reviewable, linkable, and durable.
- New agents and contributors can check prior constraints before proposing changes.

### Negative

- Meaningful decisions require a small documentation step in the same PR.

### Neutral

- Small implementation details do not need ADRs; reserve records for decisions with lasting consequences.
