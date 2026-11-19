# Changelog

All notable changes to WME Junction Cleaner will be documented here.

## [0.2.1-beta] - 2026-11-18

### Fixed

- Fixed false negatives in segment compatibility checks caused by default lane information.
- Improved detection of custom lane configurations.
- Allowed merging compatible segments containing default single-lane metadata.

### Safety

- Preserved existing segment compatibility and junction validation checks.
- Maintained protection against merging segments with custom lane configurations.

## [0.2.0-beta]

### Added
- Draggable floating Clean Junctions control.
- Persistent button position using localStorage.
- Floating status messages and viewport bounds for dragging.
- Protection against simultaneous cleaning operations from the sidebar and floating control.

## [0.1.1]

### Changed
- Simplified SDK initialization and sequential merge results.
- Improved candidate validation to require distinct segment IDs.
- Removed temporary debugging functions and diagnostic logging while retaining error reporting.

## [0.1.0]

### Added
- Highlighting of junction nodes with two connected segments.
- JC sidebar tab and segment-chain detection.
- Conservative compatibility checks and confirmation before editing.
- Sequential pairwise segment merging with revalidation and stop-on-error behavior.
- Highlight refresh after map edits and undo operations.
