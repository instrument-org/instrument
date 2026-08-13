# v1.6 beta changes

Range: `v1.5.0..v1.6.0-beta.4`, covering `v1.6.0-beta.0` through `v1.6.0-beta.4`.

These are review-worthy product surfaces rather than a chronological changelog. Commits authored by or co-authored with Neil Renicker are excluded, as are developer-mode-only surfaces. Screenshots were captured from the installed production macOS build at `v1.6.0-beta.4` (`01fa65b725ba3bae30efd4a08840753437ea017a`).

- **Writable folder access**

  Location: Project details and the new-task composer.

  Local folders can now be shared read-only or with full access, with the chosen permission shown directly on each folder row and enforced by the workspace mount.

  Source changes: [f381e4beb](https://github.com/instrument-org/instrument/commit/f381e4beb), [78ae3c0d0](https://github.com/instrument-org/instrument/commit/78ae3c0d0), [096e533f8](https://github.com/instrument-org/instrument/commit/096e533f8)

  Screenshot:

  ![Attached folder list with a permission control on each row](images/folder-access.png)

  Folder names and locations were replaced with generic labels before capture; the component layout and controls are unchanged.

  ```text
  Use these commits as repo context for writable folder access: f381e4beb 78ae3c0d0 096e533f8

  Location: Project details and the new-task composer.
  ```

- **Composer Add menu**

  Location: New-task and task composers.

  Files, local folders, projects, and skills now share one Add menu behind the composer plus button, with project selection and long skill lists handled inside the same bounded surface.

  Source changes: [e05b69f4f](https://github.com/instrument-org/instrument/commit/e05b69f4f), [f8fd847be](https://github.com/instrument-org/instrument/commit/f8fd847be), [cc7e6a082](https://github.com/instrument-org/instrument/commit/cc7e6a082)

  Screenshot:

  ![Composer Add menu showing files, folders, projects, and skills](images/composer-add-menu.png)

  ```text
  Use these commits as repo context for the composer Add menu: e05b69f4f f8fd847be cc7e6a082

  Location: New-task and task composers.
  ```

- **Agent file handoff**

  Location: Studio task transcript.

  Files named by an agent now render as type-aware, clickable file controls, including compatibility rendering for files produced by tasks from before the structured file fence existed.

  Source changes: [9b07f7e7c](https://github.com/instrument-org/instrument/commit/9b07f7e7c), [9161b9eaf](https://github.com/instrument-org/instrument/commit/9161b9eaf), [17ada1c24](https://github.com/instrument-org/instrument/commit/17ada1c24), [a2fd717c2](https://github.com/instrument-org/instrument/commit/a2fd717c2)

  Screenshot:

  ![Assistant response with type-aware links to generated presentation, spreadsheet, document, PDF, and CSV files](images/agent-file-handoff.png)

  ```text
  Use these commits as repo context for agent file handoff: 9b07f7e7c 9161b9eaf 17ada1c24 a2fd717c2

  Location: Studio task transcript.
  ```

- **Grouped transcript activity**

  Location: Studio task transcript.

  Consecutive tool calls now fold under purpose-based activity rows, while prose ends the current phase and the Instrument wordmark and working row establish a stable start for each turn.

  Source changes: [08acfdc9c](https://github.com/instrument-org/instrument/commit/08acfdc9c), [9706e51a2](https://github.com/instrument-org/instrument/commit/9706e51a2), [5207402bb](https://github.com/instrument-org/instrument/commit/5207402bb), [cbfd055a4](https://github.com/instrument-org/instrument/commit/cbfd055a4)

  Screenshot:

  ![Transcript fixture with named activity rows interleaved with the agent's commentary](images/grouped-transcript.png)

  ```text
  Use these commits as repo context for grouped transcript activity: 08acfdc9c 9706e51a2 5207402bb cbfd055a4

  Location: Studio task transcript.
  ```

- **Tabbed task pane**

  Location: Right side of a Studio task.

  The task's browser and open files now live in one tabbed pane with a fixed Browser tab, closable and reorderable file tabs, and compression when the strip runs out of room.

  Source changes: [855a9645e](https://github.com/instrument-org/instrument/commit/855a9645e), [a6447e442](https://github.com/instrument-org/instrument/commit/a6447e442), [de6516e8a](https://github.com/instrument-org/instrument/commit/de6516e8a), [69f83a5bd](https://github.com/instrument-org/instrument/commit/69f83a5bd)

  Screenshot:

  ![Tabbed task pane with fixed Browser tab and an open CSV file](images/tabbed-task-pane.png)

  ```text
  Use these commits as repo context for the tabbed task pane: 855a9645e a6447e442 de6516e8a 69f83a5bd

  Location: Right side of a Studio task.
  ```

- **Readable text files**

  Location: Studio task file viewer.

  Plain-text files now use a reading-oriented presentation, while code and source views wrap long lines by default and expose a persistent Wrap lines toggle for fixed-width content.

  Source changes: [e5f894ea2](https://github.com/instrument-org/instrument/commit/e5f894ea2), [6b380d2f3](https://github.com/instrument-org/instrument/commit/6b380d2f3)

  Screenshot:

  ![File viewer overflow menu with Wrap lines enabled](images/file-viewer-wrap-lines.png)

  ```text
  Use these commits as repo context for readable text files: e5f894ea2 6b380d2f3

  Location: Studio task file viewer.
  ```

- **Error recovery actions**

  Location: Failed turns in the Studio task transcript.

  Failed turns now translate provider failures into product language, let Try again rerun the turn without adding a synthetic user message, and explain what starting a new task preserves and leaves behind.

  Source changes: [f9b7f0d32](https://github.com/instrument-org/instrument/commit/f9b7f0d32), [95db33867](https://github.com/instrument-org/instrument/commit/95db33867), [33b47546b](https://github.com/instrument-org/instrument/commit/33b47546b)

  Screenshot:

  ![Failed turn with product-language error details and Start new task and Try again actions](images/error-recovery.png)

  ```text
  Use these commits as repo context for error recovery actions: f9b7f0d32 95db33867 33b47546b

  Location: Failed turns in the Studio task transcript.
  ```
